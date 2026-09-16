import { Diagnostic, DiagnosticSeverity } from 'vscode-languageserver/node';
import { Parser, WorkflowNode, LocationNode, TraceNode, PredicateNode } from './parser';

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
          end: { line: loc.range.start.line, character: loc.range.start.character + 1 + loc.name.length }
        },
        message: `Duplicate location definition '<${loc.name}>'`,
        source: 'swirl'
      });
    } else {
      knownLocs.set(loc.name, loc);
    }
  }

  // Helper to collect all predicates recursively
  function collectPredicates(trace: TraceNode | undefined, acc: PredicateNode[] = []): PredicateNode[] {
    if (!trace) return acc;
    if (trace.kind === 'tracePred') {
      acc.push(trace.pred);
    } else if (trace.kind === 'traceRepl') {
      collectPredicates(trace.subTrace, acc);
    } else if (trace.kind === 'traceParen') {
      collectPredicates(trace.inner, acc);
    } else if (trace.kind === 'traceOp') {
      collectPredicates(trace.left, acc);
      collectPredicates(trace.right, acc);
    }
    return acc;
  }

  interface CommEndpoint {
    src: string;
    dst: string;
    data: string;
    port: string;
    range: { start: { line: number; character: number }; end: { line: number; character: number } };
    locName: string;
  }

  const sends: CommEndpoint[] = [];
  const recvs: CommEndpoint[] = [];

  // 2. Validate location boundaries and references inside predicates
  for (const loc of wf.locations) {
    const preds = collectPredicates(loc.trace);

    for (const p of preds) {
      if (p.kind === 'exec') {
        for (const target of p.mapping.locations) {
          if (!knownLocs.has(target)) {
            diagnostics.push({
              severity: DiagnosticSeverity.Error,
              range: {
                start: { line: p.mapping.range.start.line, character: p.mapping.range.start.character },
                end: { line: p.mapping.range.end.line, character: p.mapping.range.end.character }
              },
              message: `Unknown location '${target}' in exec mapping target`,
              source: 'swirl'
            });
          }
        }
      } else if (p.kind === 'send' || p.kind === 'move') {
        // Validate source location
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
        } else if (p.src !== loc.name) {
          diagnostics.push({
            severity: DiagnosticSeverity.Warning,
            range: {
              start: { line: p.range.start.line, character: p.range.start.character },
              end: { line: p.range.end.line, character: p.range.end.character }
            },
            message: `${p.kind} defined inside location '<${loc.name}>' specifies conflicting source '${p.src}'`,
            source: 'swirl'
          });
        }

        // Validate destination locations
        for (const dst of p.dst.locations) {
          if (!knownLocs.has(dst)) {
            diagnostics.push({
              severity: DiagnosticSeverity.Error,
              range: {
                start: { line: p.dst.range.start.line, character: p.dst.range.start.character },
                end: { line: p.dst.range.end.line, character: p.dst.range.end.character }
              },
              message: `Unknown destination location '${dst}' in ${p.kind}`,
              source: 'swirl'
            });
          }
          sends.push({
            src: p.src,
            dst,
            data: p.data.name,
            port: p.port,
            range: p.range,
            locName: loc.name
          });
        }
      } else if (p.kind === 'recv') {
        // Validate source location
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

        // Validate destination location
        if (!p.dst.locations.includes(loc.name)) {
          diagnostics.push({
            severity: DiagnosticSeverity.Warning,
            range: {
              start: { line: p.range.start.line, character: p.range.start.character },
              end: { line: p.range.end.line, character: p.range.end.character }
            },
            message: `recv inside location '<${loc.name}>' specifies destination '${p.dst.locations.join(', ')}' which does not include '<${loc.name}>'`,
            source: 'swirl'
          });
        }

        for (const dst of p.dst.locations) {
          if (!knownLocs.has(dst)) {
            diagnostics.push({
              severity: DiagnosticSeverity.Error,
              range: {
                start: { line: p.dst.range.start.line, character: p.dst.range.start.character },
                end: { line: p.dst.range.end.line, character: p.dst.range.end.character }
              },
              message: `Unknown destination location '${dst}' in recv`,
              source: 'swirl'
            });
          }
          recvs.push({
            src: p.src,
            dst,
            data: p.data.name,
            port: p.port,
            range: p.range,
            locName: loc.name
          });
        }
      }
    }
  }

  // 3. Channel Pairing (Deadlock & Mismatch Check)
  // Only execute when the document has at least 2 defined locations
  if (wf.locations.length > 1) {
    for (const s of sends) {
      if (!knownLocs.has(s.dst)) continue;
      const match = recvs.some(
        (r) =>
          r.src === s.src &&
          r.dst === s.dst &&
          (r.port === s.port || r.data === s.data || r.port === s.data || r.data === s.port)
      );
      if (!match) {
        diagnostics.push({
          severity: DiagnosticSeverity.Warning,
          range: {
            start: { line: s.range.start.line, character: s.range.start.character },
            end: { line: s.range.end.line, character: s.range.end.character }
          },
          message: `Potentially unmatched communication: send from '${s.src}' to '${s.dst}' on port/data '${s.port}' has no corresponding recv in '<${s.dst}>'`,
          source: 'swirl'
        });
      }
    }

    for (const r of recvs) {
      if (!knownLocs.has(r.src)) continue;
      const match = sends.some(
        (s) =>
          s.src === r.src &&
          s.dst === r.dst &&
          (s.port === r.port || s.data === r.data || s.port === r.data || s.data === r.port)
      );
      if (!match) {
        diagnostics.push({
          severity: DiagnosticSeverity.Warning,
          range: {
            start: { line: r.range.start.line, character: r.range.start.character },
            end: { line: r.range.end.line, character: r.range.end.character }
          },
          message: `Potentially unmatched communication: recv from '${r.src}' at '<${r.dst}>' on port/data '${r.port}' has no corresponding send/move in '<${r.src}>'`,
          source: 'swirl'
        });
      }
    }
  }

  // 4. Validate Compiler Hints Pairing
  const hintStack: { text: string; range: { start: { line: number; character: number }; end: { line: number; character: number } } }[] = [];
  for (const c of parser.comments) {
    if (c.text.includes('@compiler_hint_start')) {
      hintStack.push({ text: c.text, range: c.range });
    } else if (c.text.includes('@compiler_hint_end')) {
      if (hintStack.length === 0) {
        diagnostics.push({
          severity: DiagnosticSeverity.Warning,
          range: {
            start: { line: c.range.start.line, character: c.range.start.character },
            end: { line: c.range.end.line, character: c.range.end.character }
          },
          message: 'Unmatched @compiler_hint_end directive without preceding @compiler_hint_start',
          source: 'swirl'
        });
      } else {
        hintStack.pop();
      }
    }
  }

  for (const unclosed of hintStack) {
    diagnostics.push({
      severity: DiagnosticSeverity.Warning,
      range: {
        start: { line: unclosed.range.start.line, character: unclosed.range.start.character },
        end: { line: unclosed.range.end.line, character: unclosed.range.end.character }
      },
      message: 'Unclosed @compiler_hint_start directive missing matching @compiler_hint_end',
      source: 'swirl'
    });
  }

  return diagnostics;
}
