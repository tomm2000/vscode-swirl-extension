import { Diagnostic, DiagnosticSeverity } from 'vscode-languageserver/node';
import {
  Parser,
  WorkflowNode,
  LocationNode,
  TraceNode,
  PredicateNode,
  CommentNode,
  CompilerHintInfo,
  parseCompilerHint
} from './parser';

/**
 * Performs semantic validation on a Swirl document.
 * Detects unknown locations, mismatched communication endpoints,
 * orphaned send/recv channels, and unclosed compiler hints.
 */
export function analyzeSemantics(text: string): Diagnostic[] {
  const parser = new Parser(text);
  const wf = parser.parseWorkflow();

  // If there are raw syntax errors from the parser, report those first
  if (parser.diagnostics.length > 0) {
    return parser.diagnostics.map((d) => ({
      severity: d.severity,
      range: {
        start: { line: d.range.start.line, character: d.range.start.character },
        end: { line: d.range.end.line, character: d.range.end.character }
      },
      message: d.message,
      source: 'swirl'
    }));
  }

  const diagnostics: Diagnostic[] = [];
  const knownLocs = new Map<string, LocationNode>();

  // 1. Detect duplicate location declarations
  for (const loc of wf.locations) {
    if (knownLocs.has(loc.name)) {
      diagnostics.push({
        severity: DiagnosticSeverity.Error,
        range: {
          start: { line: loc.range.start.line, character: loc.range.start.character },
          end: { line: loc.range.end.line, character: loc.range.end.character }
        },
        message: `Duplicate location definition '<${loc.name}>' is defined multiple times.`,
        source: 'swirl'
      });
    } else {
      knownLocs.set(loc.name, loc);
    }
  }

  // 2. Collect communication channels: sends, recvs, moves
  interface SendRecord {
    src: string;
    dst: string;
    port: string;
    range: { start: { line: number; character: number }; end: { line: number; character: number } };
  }

  interface RecvRecord {
    src: string;
    dst: string;
    port: string;
    range: { start: { line: number; character: number }; end: { line: number; character: number } };
  }

  const allSends: SendRecord[] = [];
  const allRecvs: RecvRecord[] = [];

  function validateTrace(trace: TraceNode | undefined, currentLoc: string): void {
    if (!trace) return;

    if (trace.kind === 'tracePred') {
      const p = trace.pred;
      if (p.kind === 'exec') {
        // Validate mapping locations exist
        for (const loc of p.mapping.locations) {
          if (!knownLocs.has(loc)) {
            diagnostics.push({
              severity: DiagnosticSeverity.Error,
              range: {
                start: { line: p.range.start.line, character: p.range.start.character },
                end: { line: p.range.end.line, character: p.range.end.character }
              },
              message: `Unknown location '${loc}' referenced in exec mapping {${p.mapping.locations.join(', ')}}`,
              source: 'swirl'
            });
          }
        }
      } else if (p.kind === 'send' || p.kind === 'move') {
        // Validate src location matches current location (if single loc context)
        if (p.src !== currentLoc) {
          diagnostics.push({
            severity: DiagnosticSeverity.Warning,
            range: {
              start: { line: p.range.start.line, character: p.range.start.character },
              end: { line: p.range.end.line, character: p.range.end.character }
            },
            message: `${p.kind} source '${p.src}' does not match enclosing location '<${currentLoc}>' (conflicting source)`,
            source: 'swirl'
          });
        }
        if (!knownLocs.has(p.src)) {
          diagnostics.push({
            severity: DiagnosticSeverity.Error,
            range: {
              start: { line: p.range.start.line, character: p.range.start.character },
              end: { line: p.range.end.line, character: p.range.end.character }
            },
            message: `Unknown source location '${p.src}' in ${p.kind}`,
            source: 'swirl'
          });
        }
        for (const d of p.dst.locations) {
          if (!knownLocs.has(d)) {
            diagnostics.push({
              severity: DiagnosticSeverity.Error,
              range: {
                start: { line: p.range.start.line, character: p.range.start.character },
                end: { line: p.range.end.line, character: p.range.end.character }
              },
              message: `Unknown destination location '${d}' in ${p.kind}`,
              source: 'swirl'
            });
          }
          allSends.push({
            src: p.src,
            dst: d,
            port: p.port,
            range: {
              start: { line: p.range.start.line, character: p.range.start.character },
              end: { line: p.range.end.line, character: p.range.end.character }
            }
          });
        }
      } else if (p.kind === 'recv') {
        // Destination is the current location
        if (!knownLocs.has(p.src)) {
          diagnostics.push({
            severity: DiagnosticSeverity.Error,
            range: {
              start: { line: p.range.start.line, character: p.range.start.character },
              end: { line: p.range.end.line, character: p.range.end.character }
            },
            message: `Unknown source location '${p.src}' in recv`,
            source: 'swirl'
          });
        }
        for (const d of p.dst.locations) {
          if (!knownLocs.has(d)) {
            diagnostics.push({
              severity: DiagnosticSeverity.Error,
              range: {
                start: { line: p.range.start.line, character: p.range.start.character },
                end: { line: p.range.end.line, character: p.range.end.character }
              },
              message: `Unknown destination location '${d}' in recv`,
              source: 'swirl'
            });
          }
          allRecvs.push({
            src: p.src,
            dst: d,
            port: p.port,
            range: {
              start: { line: p.range.start.line, character: p.range.start.character },
              end: { line: p.range.end.line, character: p.range.end.character }
            }
          });
        }
      }
    } else if (trace.kind === 'traceRepl') {
      validateTrace(trace.subTrace, currentLoc);
    } else if (trace.kind === 'traceParen') {
      validateTrace(trace.inner, currentLoc);
    } else if (trace.kind === 'traceOp') {
      validateTrace(trace.left, currentLoc);
      validateTrace(trace.right, currentLoc);
    }
  }

  for (const loc of wf.locations) {
    validateTrace(loc.trace, loc.name);
  }

  // 3. Orphaned / Unmatched channel checking
  // Cross-check sends with recvs
  for (const s of allSends) {
    // Look for matching recv
    const hasMatch = allRecvs.some(
      (r) =>
        r.src === s.src &&
        r.dst === s.dst &&
        (r.port === s.port || r.port.includes(s.port) || s.port.includes(r.port) || s.port === 'eof' || r.port === 'eof')
    );
    if (!hasMatch && knownLocs.has(s.dst)) {
      diagnostics.push({
        severity: DiagnosticSeverity.Information,
        range: {
          start: { line: s.range.start.line, character: s.range.start.character },
          end: { line: s.range.end.line, character: s.range.end.character }
        },
        message: `Potentially unmatched communication: send from '<${s.src}>' to '<${s.dst}>' on port '${s.port}' has no corresponding recv in '<${s.dst}>'`,
        source: 'swirl'
      });
    }
  }

  for (const r of allRecvs) {
    const hasMatch = allSends.some(
      (s) =>
        s.src === r.src &&
        s.dst === r.dst &&
        (s.port === r.port || s.port.includes(r.port) || r.port.includes(s.port) || s.port === 'eof' || r.port === 'eof')
    );
    if (!hasMatch && knownLocs.has(r.src)) {
      diagnostics.push({
        severity: DiagnosticSeverity.Information,
        range: {
          start: { line: r.range.start.line, character: r.range.start.character },
          end: { line: r.range.end.line, character: r.range.end.character }
        },
        message: `Potentially unmatched communication: recv from '${r.src}' at '<${r.dst}>' on port/data '${r.port}' has no corresponding send/move in '<${r.src}>'`,
        source: 'swirl'
      });
    }
  }

  // 4. Validate Compiler Hints Pairing
  interface HintStackEntry {
    info: CompilerHintInfo;
    comment: CommentNode;
  }
  const hintStack: HintStackEntry[] = [];
  for (const c of parser.comments) {
    const info = c.hintInfo || parseCompilerHint(c.text);
    if (!info) continue;

    if (info.action === 'begin') {
      hintStack.push({ info, comment: c });
    } else if (info.action === 'end') {
      if (hintStack.length === 0) {
        diagnostics.push({
          severity: DiagnosticSeverity.Warning,
          range: {
            start: { line: c.range.start.line, character: c.range.start.character },
            end: { line: c.range.end.line, character: c.range.end.character }
          },
          message: c.text.includes('@compiler_hint_end') ? 'Unmatched @compiler_hint_end directive without preceding @compiler_hint_start' : `Unmatched compiler hint end directive '${info.tag || 'end'}' without preceding begin`,
          source: 'swirl'
        });
      } else {
        const open = hintStack.pop()!;
        if (info.region !== undefined && open.info.region !== undefined && info.region !== open.info.region) {
          diagnostics.push({
            severity: DiagnosticSeverity.Warning,
            range: {
              start: { line: c.range.start.line, character: c.range.start.character },
              end: { line: c.range.end.line, character: c.range.end.character }
            },
            message: `Mismatched compiler hint region: end specifies region ${info.region}, but open block was region ${open.info.region}`,
            source: 'swirl'
          });
        } else if (info.tag && open.info.tag && info.tag !== open.info.tag) {
          diagnostics.push({
            severity: DiagnosticSeverity.Warning,
            range: {
              start: { line: c.range.start.line, character: c.range.start.character },
              end: { line: c.range.end.line, character: c.range.end.character }
            },
            message: `Mismatched compiler hint phase: end specifies '${info.tag}', but open block was '${open.info.tag}'`,
            source: 'swirl'
          });
        }
      }
    }
  }

  for (const unclosed of hintStack) {
    diagnostics.push({
      severity: DiagnosticSeverity.Warning,
      range: {
        start: { line: unclosed.comment.range.start.line, character: unclosed.comment.range.start.character },
        end: { line: unclosed.comment.range.end.line, character: unclosed.comment.range.end.character }
      },
      message: unclosed.comment.text.includes('@compiler_hint_start') ? 'Unclosed @compiler_hint_start directive missing matching @compiler_hint_end' : `Unclosed compiler hint begin directive '${unclosed.info.tag || 'begin'}' missing matching end`,
      source: 'swirl'
    });
  }

  return diagnostics;
}
