import { InlayHint, InlayHintKind, Range, Position } from 'vscode-languageserver/node';
import { Parser, WorkflowNode, LocationNode, TraceNode, PredicateNode } from './parser';

export interface InlayHintSettings {
  enableParameterNames?: boolean;
  execFlowStyle?: 'inOut' | 'flow';
  enableLocationTags?: boolean;
}

const DEFAULT_SETTINGS: Required<InlayHintSettings> = {
  enableParameterNames: true,
  execFlowStyle: 'inOut',
  enableLocationTags: false
};

/**
 * Computes parameter inlay hints for Swirl predicates (exec, send, recv, move)
 * and optionally location definitions.
 */
export function getInlayHints(
  text: string,
  range?: Range,
  settings?: InlayHintSettings
): InlayHint[] {
  const opts: Required<InlayHintSettings> = {
    enableParameterNames: settings?.enableParameterNames ?? DEFAULT_SETTINGS.enableParameterNames,
    execFlowStyle: settings?.execFlowStyle ?? DEFAULT_SETTINGS.execFlowStyle,
    enableLocationTags: settings?.enableLocationTags ?? DEFAULT_SETTINGS.enableLocationTags
  };

  const parser = new Parser(text);
  const wf = parser.parseWorkflow();
  const hints: InlayHint[] = [];

  function isPosInRange(pos: Position): boolean {
    if (!range) return true;
    if (pos.line < range.start.line || pos.line > range.end.line) return false;
    if (pos.line === range.start.line && pos.character < range.start.character) return false;
    if (pos.line === range.end.line && pos.character > range.end.character) return false;
    return true;
  }

  function addHint(hint: InlayHint): void {
    if (isPosInRange(hint.position)) {
      hints.push(hint);
    }
  }

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

  for (const loc of wf.locations) {
    if (opts.enableLocationTags) {
      if (loc.nameRange) {
        addHint({
          position: { line: loc.nameRange.start.line, character: loc.nameRange.start.character },
          label: 'loc:',
          kind: InlayHintKind.Parameter,
          paddingRight: true,
          tooltip: 'Location identifier name'
        });
      }
      addHint({
        position: { line: loc.dataset.range.start.line, character: loc.dataset.range.start.character },
        label: 'data:',
        kind: InlayHintKind.Parameter,
        paddingRight: true,
        tooltip: 'Initial location dataset'
      });
      addHint({
        position: { line: loc.trace.range.start.line, character: loc.trace.range.start.character },
        label: 'trace:',
        kind: InlayHintKind.Parameter,
        paddingRight: true,
        tooltip: 'Process execution trace'
      });
    }

    if (!opts.enableParameterNames) {
      continue;
    }

    const preds = collectPredicates(loc.trace);
    for (const p of preds) {
      if (p.kind === 'exec') {
        // Parameter 1: step
        if (p.stepRange) {
          addHint({
            position: { line: p.stepRange.start.line, character: p.stepRange.start.character },
            label: 'step:',
            kind: InlayHintKind.Parameter,
            paddingRight: true,
            tooltip: 'Computational step identifier to execute'
          });
        }

        // Parameter 2: flow (inOut or flow style)
        if (opts.execFlowStyle === 'flow') {
          addHint({
            position: { line: p.flow.from.range.start.line, character: p.flow.from.range.start.character },
            label: 'flow:',
            kind: InlayHintKind.Parameter,
            paddingRight: true,
            tooltip: 'Input-to-output dataflow specification'
          });
        } else {
          addHint({
            position: { line: p.flow.from.range.start.line, character: p.flow.from.range.start.character },
            label: 'in:',
            kind: InlayHintKind.Parameter,
            paddingRight: true,
            tooltip: 'Input dataset consumed by the step'
          });
          addHint({
            position: { line: p.flow.to.range.start.line, character: p.flow.to.range.start.character },
            label: 'out:',
            kind: InlayHintKind.Parameter,
            paddingRight: true,
            tooltip: 'Output dataset produced by the step'
          });
        }

        // Parameter 3: mapping target locations
        addHint({
          position: { line: p.mapping.range.start.line, character: p.mapping.range.start.character },
          label: 'mapping:',
          kind: InlayHintKind.Parameter,
          paddingRight: true,
          tooltip: 'Target location(s) where this step executes'
        });
      } else if (p.kind === 'send' || p.kind === 'recv' || p.kind === 'move' || p.kind === 'scatter_send' || p.kind === 'gather_recv') {
        // send, recv, move
        // Parameter 1: data
        addHint({
          position: { line: p.data.range.start.line, character: p.data.range.start.character },
          label: 'data:',
          kind: InlayHintKind.Parameter,
          paddingRight: true,
          tooltip: p.kind === 'recv' ? 'Incoming data binding' : 'Data payload to transfer'
        });

        // Parameter 2: port
        if (p.portRange) {
          addHint({
            position: { line: p.portRange.start.line, character: p.portRange.start.character },
            label: 'port:',
            kind: InlayHintKind.Parameter,
            paddingRight: true,
            tooltip: 'Communication port name'
          });
        }

        // Parameter 3: src
        if (p.srcRange) {
          addHint({
            position: { line: p.srcRange.start.line, character: p.srcRange.start.character },
            label: 'src:',
            kind: InlayHintKind.Parameter,
            paddingRight: true,
            tooltip: 'Originating source location'
          });
        }

        // Parameter 4: dst
        addHint({
          position: { line: p.dst.range.start.line, character: p.dst.range.start.character },
          label: 'dst:',
          kind: InlayHintKind.Parameter,
          paddingRight: true,
          tooltip: 'Target destination location(s)'
        });
      }
    }
  }

  return hints;
}
