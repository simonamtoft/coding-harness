import { DynamicBorder } from "@earendil-works/pi-coding-agent";
import { Container, Editor, Key, matchesKey, truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import {
  buildHeading,
  buildSelectItems,
  CUSTOM_ANSWER_VALUE,
  type PanelAnswer,
  type PanelItem,
  type QuestionSpec,
} from "./question-items.ts";

type Style = (line: string) => string;
type Theme = { fg: (color: string, text: string) => string; bold: (text: string) => string };

const PADDING = " ";
const CURSOR = "> ";
const LABEL_CONTINUATION = "  ";
const DESCRIPTION_INDENT = "    ";

/**
 * Wraps plain text to the remaining width and styles each resulting line.
 * Styling must be applied per line: the TUI resets SGR at every line end.
 */
function wrapStyled(text: string, width: number, style: Style, indent: string): string[] {
  const available = Math.max(1, width - indent.length);
  return wrapTextWithAnsi(text, available).map((line) => truncateToWidth(`${indent}${style(line)}`, width));
}

/** Render cache keyed on width: the TUI re-renders on resize without calling invalidate(). */
abstract class WidthCached {
  private cachedWidth = -1;
  private cachedLines: string[] = [];

  render(width: number): string[] {
    if (this.cachedWidth !== width) {
      this.cachedLines = this.build(width);
      this.cachedWidth = width;
    }
    return this.cachedLines;
  }

  invalidate(): void {
    this.cachedWidth = -1;
  }

  protected abstract build(width: number): string[];
}

class WrappedText extends WidthCached {
  constructor(
    private readonly text: string,
    private readonly style: Style,
  ) {
    super();
  }

  protected build(width: number): string[] {
    return wrapStyled(this.text, width, this.style, PADDING);
  }
}

/**
 * The option list. Hand-rolled rather than using SelectList because that
 * component renders one truncated line per item, which clips long labels and
 * descriptions. Options are shown in the order given, best first.
 */
class OptionList extends WidthCached {
  private focused = 0;

  onSelect?: (item: PanelItem) => void;
  onCancel?: () => void;

  constructor(
    private readonly items: PanelItem[],
    private readonly theme: Theme,
  ) {
    super();
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.up)) {
      this.focused = Math.max(0, this.focused - 1);
      this.invalidate();
    } else if (matchesKey(data, Key.down)) {
      this.focused = Math.min(this.items.length - 1, this.focused + 1);
      this.invalidate();
    } else if (matchesKey(data, Key.enter)) {
      this.onSelect?.(this.items[this.focused]);
    } else if (matchesKey(data, Key.escape)) {
      this.onCancel?.();
    }
  }

  protected build(width: number): string[] {
    return this.items.flatMap((item, index) => {
      const isFocused = index === this.focused;
      const style: Style = (line) => this.theme.fg(isFocused ? "accent" : "text", line);
      const labelWidth = Math.max(1, width - PADDING.length - CURSOR.length);
      const lines = wrapTextWithAnsi(item.label, labelWidth).map((line, lineIndex) => {
        const marker = lineIndex === 0 && isFocused ? this.theme.fg("accent", CURSOR) : LABEL_CONTINUATION;
        return truncateToWidth(`${PADDING}${marker}${style(line)}`, width);
      });

      if (!item.description) return lines;
      return [
        ...lines,
        ...wrapStyled(item.description, width, (line) => this.theme.fg("muted", line), DESCRIPTION_INDENT),
      ];
    });
  }
}

/**
 * Renders one option question as a bordered panel. Requires `ctx.mode === "tui"`;
 * `ctx.ui.custom()` resolves to undefined in every other mode.
 * Resolves to undefined when the user cancels.
 */
export function askWithPanel(
  ctx: {
    ui: {
      custom: <T>(
        factory: (
          tui: { requestRender: () => void },
          theme: Theme,
          keybindings: unknown,
          done: (result: T) => void,
        ) => { render: (width: number) => string[]; invalidate: () => void; handleInput: (data: string) => void },
      ) => Promise<T>;
    };
  },
  spec: QuestionSpec,
  position?: { index: number; total: number },
): Promise<PanelAnswer | undefined> {
  const options = spec.options ?? [];
  const items = buildSelectItems(options);

  return ctx.ui.custom<PanelAnswer | undefined>((tui, theme, _keybindings, done) => {
    const container = new Container();
    const optionList = new OptionList(items, theme);
    const editor = new Editor(tui, {
      borderColor: (line: string) => theme.fg("accent", line),
      selectList: {
        selectedPrefix: (line: string) => theme.fg("accent", line),
        selectedText: (line: string) => theme.fg("accent", line),
        description: (line: string) => theme.fg("muted", line),
        scrollInfo: (line: string) => theme.fg("dim", line),
        noMatch: (line: string) => theme.fg("warning", line),
      },
    });
    let editing = false;

    optionList.onSelect = (item) => {
      if (item.value !== CUSTOM_ANSWER_VALUE) {
        done({ answer: options[Number(item.value)].label, wasCustom: false });
        return;
      }
      editing = true;
      editor.setText("");
      rebuild();
      tui.requestRender();
    };
    optionList.onCancel = () => done(undefined);

    editor.onSubmit = (value: string) => {
      const answer = value.trim();
      if (answer.length > 0) done({ answer, wasCustom: true });
    };

    function rebuild(): void {
      container.clear();
      container.addChild(new DynamicBorder((line: string) => theme.fg("accent", line)));
      container.addChild(
        new WrappedText(buildHeading(spec.question, position), (line) => theme.fg("accent", theme.bold(line))),
      );
      if (spec.details) {
        container.addChild(new WrappedText(spec.details, (line) => theme.fg("muted", line)));
      }

      if (editing) {
        container.addChild(
          new WrappedText(spec.placeholder ?? "Write your answer:", (line) => theme.fg("muted", line)),
        );
        container.addChild(editor);
        container.addChild(new WrappedText("enter submit • esc back to options", (line) => theme.fg("dim", line)));
      } else {
        container.addChild(optionList);
        container.addChild(
          new WrappedText("↑↓ navigate • enter select • esc cancel", (line) => theme.fg("dim", line)),
        );
      }

      container.addChild(new DynamicBorder((line: string) => theme.fg("accent", line)));
    }

    rebuild();

    return {
      render: (width: number) => container.render(width),
      invalidate: () => {
        container.invalidate();
        rebuild();
      },
      handleInput: (data: string) => {
        if (!editing) {
          optionList.handleInput(data);
          tui.requestRender();
          return;
        }
        if (matchesKey(data, Key.escape)) {
          editing = false;
          rebuild();
        } else {
          editor.handleInput(data);
        }
        tui.requestRender();
      },
    };
  });
}
