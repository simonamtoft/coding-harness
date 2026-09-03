import { DynamicBorder } from "@earendil-works/pi-coding-agent";
import { Container, Editor, Key, matchesKey, truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import {
  BACK_VALUE,
  buildHeading,
  buildSelectItems,
  CUSTOM_ANSWER_VALUE,
  DONE_VALUE,
  type PanelAnswer,
  type PanelItem,
  type PanelResult,
  type QuestionSpec,
} from "./question-items.ts";

type Style = (line: string) => string;
type Theme = { fg: (color: string, text: string) => string; bold: (text: string) => string };

const PADDING = " ";
const CURSOR = "> ";
const LABEL_CONTINUATION = "  ";
const DESCRIPTION_INDENT = "    ";
const CUSTOM_ANSWER_SNIPPET_LENGTH = 60;

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
    private readonly selected: Set<number>,
    private readonly customAnswer: () => string | undefined,
    private readonly multiple: boolean,
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
      const isSelectable = /^\d+\. /.test(item.label);
      const isChecked = item.value === CUSTOM_ANSWER_VALUE
        ? this.customAnswer() !== undefined
        : this.selected.has(Number(item.value));
      const label = this.multiple && isSelectable
        ? item.label.replace(/^(\d+\. )/, `${isChecked ? "[x]" : "[ ]"} $1`)
        : item.label;
      const labelWidth = Math.max(1, width - PADDING.length - CURSOR.length);
      const lines = wrapTextWithAnsi(label, labelWidth).map((line, lineIndex) => {
        const marker = lineIndex === 0 && isFocused ? this.theme.fg("accent", CURSOR) : LABEL_CONTINUATION;
        return truncateToWidth(`${PADDING}${marker}${style(line)}`, width);
      });

      const description = item.value === CUSTOM_ANSWER_VALUE && this.customAnswer()
        ? `Custom: ${this.customAnswer()!.slice(0, CUSTOM_ANSWER_SNIPPET_LENGTH)}`
        : item.description;
      if (!description) return lines;
      return [
        ...lines,
        ...wrapStyled(description, width, (line) => this.theme.fg("muted", line), DESCRIPTION_INDENT),
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
  allowBack = false,
): Promise<PanelResult> {
  const options = spec.options ?? [];
  const items = buildSelectItems(options, spec.multiple, allowBack);

  return ctx.ui.custom<PanelResult>((tui, theme, _keybindings, done) => {
    const container = new Container();
    const selected = new Set<number>();
    let customAnswer: string | undefined;
    const optionList = new OptionList(items, theme, selected, () => customAnswer, Boolean(spec.multiple));
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
      if (item.value === BACK_VALUE) {
        done("back");
        return;
      }
      if (item.value === DONE_VALUE) {
        const answer = [...options.filter((_option, index) => selected.has(index)).map((option) => option.label), ...(customAnswer ? [customAnswer] : [])];
        if (answer.length > 0) done({ answer, wasCustom: customAnswer !== undefined });
        return;
      }
      if (item.value !== CUSTOM_ANSWER_VALUE) {
        const index = Number(item.value);
        if (spec.multiple) {
          selected.has(index) ? selected.delete(index) : selected.add(index);
          optionList.invalidate();
          return;
        }
        done({ answer: options[index].label, wasCustom: false });
        return;
      }
      editing = true;
      editor.setText(customAnswer ?? "");
      rebuild();
      tui.requestRender();
    };
    optionList.onCancel = () => done(undefined);

    editor.onSubmit = (value: string) => {
      const answer = value.trim();
      if (!spec.multiple) {
        if (answer) done({ answer, wasCustom: true });
        return;
      }
      customAnswer = answer || undefined;
      editing = false;
      optionList.invalidate();
      rebuild();
      tui.requestRender();
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
          new WrappedText(spec.multiple ? "↑↓ navigate • enter toggle/select • esc cancel" : "↑↓ navigate • enter select • esc cancel", (line) => theme.fg("dim", line)),
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
