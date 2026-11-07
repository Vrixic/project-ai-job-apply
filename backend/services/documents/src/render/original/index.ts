import type { AstLine, ResumeAst } from "../../resume-ast/types.js";

export { type OriginalEditReason, OriginalEditUnsupported } from "./errors.js";
export { editOriginalPdf } from "./write.js";

/** Every source line of the resume, as parsed: what the editor needs to know about what was left out. */
export function sourceLinesOf(ast: ResumeAst): AstLine[] {
  const lines: AstLine[] = [];
  for (const section of ast.sections) {
    lines.push(...(section.heading?.lines ?? []));
    for (const entry of section.entries) {
      for (const node of [...entry.lines, ...entry.bullets]) lines.push(...(node.lines ?? []));
    }
  }
  return lines;
}
