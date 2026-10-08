export interface SimplifiedSwirlOptions {
  simplifyScatter?: boolean;
  simplifyGather?: boolean;
  mergeScatterSends?: boolean;
}

interface ScatterSendInfo {
  stream: string;
  port: string;
  src: string;
  dsts: string[];
}

function parseScatterSend(str: string): ScatterSendInfo | null {
  const trimmed = str.trim();
  let inner = trimmed;
  if (inner.startsWith('(') && inner.endsWith(')')) {
    inner = inner.slice(1, -1).trim();
  }
  const match = inner.match(
    /^scatter_send\s*\(\s*([^->]+?)\s*->\s*([^,]+?)\s*,\s*([a-zA-Z0-9_]+)\s*,\s*([a-zA-Z0-9_{},\s]+)\s*\)$/
  );
  if (!match) return null;
  const stream = match[1].trim();
  const port = match[2].trim();
  const src = match[3].trim();
  const dstRaw = match[4].trim();
  let dsts: string[] = [];
  if (dstRaw.startsWith('{') && dstRaw.endsWith('}')) {
    dsts = dstRaw
      .slice(1, -1)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  } else {
    dsts = [dstRaw];
  }
  return { stream, port, src, dsts };
}

function splitParallel(content: string): string[] {
  const parts: string[] = [];
  let current = '';
  let parenDepth = 0;
  let braceDepth = 0;
  let bracketDepth = 0;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    const next = content[i + 1];

    if (inLineComment) {
      current += ch;
      if (ch === '\n') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      current += ch;
      if (ch === '*' && next === '/') {
        current += '/';
        i++;
        inBlockComment = false;
      }
      continue;
    }
    if (ch === '/' && next === '/') {
      inLineComment = true;
      current += '//';
      i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlockComment = true;
      current += '/*';
      i++;
      continue;
    }

    if (ch === '(') parenDepth++;
    else if (ch === ')') parenDepth = Math.max(0, parenDepth - 1);
    else if (ch === '{') braceDepth++;
    else if (ch === '}') braceDepth = Math.max(0, braceDepth - 1);
    else if (ch === '[') bracketDepth++;
    else if (ch === ']') bracketDepth = Math.max(0, bracketDepth - 1);

    if (ch === '|' && parenDepth === 0 && braceDepth === 0 && bracketDepth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  parts.push(current);
  return parts;
}

function processParallelParts(
  parts: string[],
  openIndent: string
): { isSingle: boolean; result: string } | null {
  if (parts.length <= 1) return null;

  const parsedParts = parts.map((p) => ({
    raw: p,
    info: parseScatterSend(p)
  }));

  let canMerge = false;
  for (let i = 0; i < parsedParts.length; i++) {
    if (parsedParts[i].info) {
      for (let j = i + 1; j < parsedParts.length; j++) {
        if (
          parsedParts[j].info &&
          parsedParts[j].info!.stream === parsedParts[i].info!.stream &&
          parsedParts[j].info!.port === parsedParts[i].info!.port &&
          parsedParts[j].info!.src === parsedParts[i].info!.src
        ) {
          canMerge = true;
          break;
        }
      }
    }
    if (canMerge) break;
  }

  if (!canMerge) return null;

  // Check if ALL parts are scatter_send with the exact same (stream, port, src)
  const allSame = parsedParts.every(
    (p) =>
      p.info &&
      p.info.stream === parsedParts[0].info!.stream &&
      p.info.port === parsedParts[0].info!.port &&
      p.info.src === parsedParts[0].info!.src
  );

  if (allSame) {
    const info0 = parsedParts[0].info!;
    const allDsts: string[] = [];
    for (const p of parsedParts) {
      for (const d of p.info!.dsts) {
        if (!allDsts.includes(d)) allDsts.push(d);
      }
    }
    const dstStr = allDsts.length === 1 ? allDsts[0] : '{' + allDsts.join(', ') + '}';
    return {
      isSingle: true,
      result: `${openIndent}scatter_send(${info0.stream} -> ${info0.port}, ${info0.src}, ${dstStr})`
    };
  }

  // Merge matching groups
  const newParts: string[] = [];
  const processedIndices = new Set<number>();

  for (let i = 0; i < parsedParts.length; i++) {
    if (processedIndices.has(i)) continue;

    const cur = parsedParts[i];
    if (!cur.info) {
      newParts.push(cur.raw);
      continue;
    }

    const matches = [i];
    for (let j = i + 1; j < parsedParts.length; j++) {
      if (
        !processedIndices.has(j) &&
        parsedParts[j].info &&
        parsedParts[j].info!.stream === cur.info.stream &&
        parsedParts[j].info!.port === cur.info.port &&
        parsedParts[j].info!.src === cur.info.src
      ) {
        matches.push(j);
      }
    }

    if (matches.length > 1) {
      const allDsts: string[] = [];
      for (const idx of matches) {
        processedIndices.add(idx);
        for (const d of parsedParts[idx].info!.dsts) {
          if (!allDsts.includes(d)) allDsts.push(d);
        }
      }
      const lineMatch = cur.raw.match(/^(\s*)/);
      const itemIndent = lineMatch ? lineMatch[1].replace(/^\n+/, '') : openIndent + '  ';
      const dstStr = allDsts.length === 1 ? allDsts[0] : '{' + allDsts.join(', ') + '}';
      newParts.push(
        `${itemIndent}scatter_send(${cur.info.stream} -> ${cur.info.port}, ${cur.info.src}, ${dstStr})`
      );
    } else {
      newParts.push(cur.raw);
    }
  }

  if (newParts.length === 1) {
    return {
      isSingle: true,
      result: newParts[0].trim()
    };
  }

  return {
    isSingle: false,
    result: `${openIndent}(\n${newParts
      .map((p) => p.trim())
      .map((p) => openIndent + '  ' + p)
      .join('\n' + openIndent + '  |\n')}\n${openIndent})`
  };
}

export function mergeParallelScatterSends(content: string): string {
  let text = content;
  let modified = true;

  // Pass 1: Process parenthesized blocks from innermost to outermost
  while (modified) {
    modified = false;
    for (let i = 0; i < text.length; i++) {
      if (text[i] === '(') {
        let depth = 1;
        let j = i + 1;
        let inLineComment = false;
        let inBlockComment = false;

        while (j < text.length && depth > 0) {
          const ch = text[j];
          const next = text[j + 1];
          if (inLineComment) {
            if (ch === '\n') inLineComment = false;
          } else if (inBlockComment) {
            if (ch === '*' && next === '/') {
              j++;
              inBlockComment = false;
            }
          } else if (ch === '/' && next === '/') {
            inLineComment = true;
            j++;
          } else if (ch === '/' && next === '*') {
            inBlockComment = true;
            j++;
          } else if (ch === '(') {
            depth++;
          } else if (ch === ')') {
            depth--;
          }
          j++;
        }

        if (depth === 0) {
          const inner = text.substring(i + 1, j - 1);
          if (inner.includes('scatter_send') && inner.includes('|')) {
            let lineStart = i;
            while (lineStart > 0 && text[lineStart - 1] !== '\n') lineStart--;
            const prefix = text.substring(lineStart, i);
            const indentMatch = prefix.match(/^(\s*)$/);
            const openIndent = indentMatch ? indentMatch[1] : '';

            const parts = splitParallel(inner);
            const processed = processParallelParts(parts, openIndent);
            if (processed !== null) {
              text = text.substring(0, lineStart) + processed.result + text.substring(j);
              modified = true;
              break;
            }
          }
        }
      }
    }
  }

  // Pass 2: Check unparenthesized parallel sequences inside locations: `<loc, {...}, TRACE>`
  const locRegex = /(<[a-zA-Z0-9_]+\s*,\s*\{[^}]*\}\s*,\s*)([\s\S]*?)(\s*>)/g;
  text = text.replace(locRegex, (match, prefix, trace, suffix) => {
    if (!trace.includes('scatter_send') || !trace.includes('|')) {
      return match;
    }
    const parts = splitParallel(trace);
    const processed = processParallelParts(parts, '  ');
    if (processed !== null) {
      if (processed.isSingle) {
        return `${prefix}\n${processed.result}\n${suffix}`;
      } else {
        const innerContent = processed.result.replace(/^\s*\(\n/, '').replace(/\n\s*\)$/, '');
        return `${prefix}\n${innerContent}\n${suffix}`;
      }
    }
    return match;
  });

  return text;
}

/**
 * Simplifies low-level Swirl stream compiler hint blocks into high-level constructs:
 * - scatter_stream -> scatter_send(stream -> port, src, dst)
 * - gather_stream  -> gather_recv(stream -> port, src, dst)
 * - Merges parallel scatter_send calls targeting the same stream and port:
 *   (scatter_send(s -> p, l0, l1) | scatter_send(s -> p, l0, l2)) -> scatter_send(s -> p, l0, {l1, l2})
 */
export function simplifySwirl(content: string, options: SimplifiedSwirlOptions = {}): string {
  const simplifyScatter = options.simplifyScatter ?? true;
  const simplifyGather = options.simplifyGather ?? true;
  const mergeScatter = options.mergeScatterSends ?? true;

  const lines = content.split(/\r?\n/);
  const result: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const beginMatch = line.match(
      /^(\s*)\/\/\s*(?:\[compiler\](?:\([^)]*\))?|@compiler)\s+begin\s+(scatter_stream|gather_stream)\s+(.*)$/
    );

    if (beginMatch) {
      const indent = beginMatch[1];
      const kind = beginMatch[2] as 'scatter_stream' | 'gather_stream';
      const rest = beginMatch[3].trim();

      if (
        (kind === 'scatter_stream' && !simplifyScatter) ||
        (kind === 'gather_stream' && !simplifyGather)
      ) {
        result.push(line);
        i++;
        continue;
      }

      // Tokenize parameters preserving bracketed expressions e.g. port[?key_0, ?key_1]
      const tokens: string[] = [];
      let idx = 0;
      while (idx < rest.length) {
        while (idx < rest.length && /\s/.test(rest[idx])) idx++;
        if (idx >= rest.length) break;
        let token = '';
        let bDepth = 0;
        while (idx < rest.length) {
          const ch = rest[idx];
          if (ch === '[') bDepth++;
          else if (ch === ']') bDepth = Math.max(0, bDepth - 1);
          else if (/\s/.test(ch) && bDepth === 0) break;
          token += ch;
          idx++;
        }
        tokens.push(token);
      }

      const stream = tokens[0] || '';
      const worker = tokens[1] || '';
      const port = tokens[2] || '';

      // Find matching end directive
      let j = i + 1;
      let blockContent = '';
      while (j < lines.length) {
        const curLine = lines[j];
        if (
          curLine.match(
            new RegExp(
              `^\\s*\\/\\/\\s*(?:\\[compiler\\](?:\\([^)]*\\))?|@compiler)\\s+end\\s+${kind}\\b`
            )
          )
        ) {
          break;
        }
        blockContent += curLine + '\n';
        j++;
      }

      // Extract src and dst from move / send / recv inside the block
      let src = worker;
      let dst = worker;

      const predMatch = blockContent.match(
        /\b(?:move|send|recv)\s*\([^->]+->\s*[^,]+(?:\[[^\]]*\])?,\s*([a-zA-Z0-9_]+)\s*,\s*([a-zA-Z0-9_{},\s]+)\s*\)/
      );
      if (predMatch) {
        src = predMatch[1].trim();
        dst = predMatch[2].trim();
      }

      if (kind === 'scatter_stream') {
        result.push(`${indent}scatter_send(${stream} -> ${port}, ${src}, ${dst})`);
      } else {
        result.push(`${indent}gather_recv(${stream} -> ${port}, ${src}, ${dst})`);
      }

      i = j + 1;
    } else {
      result.push(line);
      i++;
    }
  }

  let simplified = result.join('\n');

  if (mergeScatter) {
    simplified = mergeParallelScatterSends(simplified);
  }

  return simplified;
}
