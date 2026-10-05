// Maps between a contenteditable element's DOM and a flat text string with '\n' line breaks,
// so the agent can use character offsets on contenteditable editors too.

export interface Seg {
  node: Node;
  start: number;
  len: number;
  /** text: a text node; br: a <br> line break; block: implicit newline at the start of a block element. */
  kind: 'text' | 'br' | 'block';
}

export interface CEModel {
  text: string;
  segs: Seg[];
}

const BLOCK = /^(DIV|P|LI|PRE|H[1-6]|BLOCKQUOTE|UL|OL|SECTION|ARTICLE|TR|TABLE)$/;
const isBlock = (n: Node) => n.nodeType === Node.ELEMENT_NODE && BLOCK.test(n.nodeName);

function hasContentAfter(node: Node): boolean {
  for (let s = node.nextSibling; s; s = s.nextSibling) {
    if (s.nodeType === Node.TEXT_NODE ? (s as Text).data.length > 0 : true) return true;
  }
  return false;
}

/** Browsers keep a placeholder <br> at the end of a block; it doesn't render a new line. */
function isTrailingBr(br: Node, root: Node): boolean {
  let n: Node = br;
  while (true) {
    if (hasContentAfter(n)) return false;
    const parent = n.parentNode;
    if (!parent || parent === root || isBlock(parent)) return true;
    n = parent;
  }
}

export function buildModel(root: HTMLElement): CEModel {
  let text = '';
  const segs: Seg[] = [];
  const visit = (node: Node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        const data = (child as Text).data;
        if (!data) continue;
        segs.push({ node: child, start: text.length, len: data.length, kind: 'text' });
        text += data;
      } else if (child.nodeName === 'BR') {
        if (isTrailingBr(child, root)) continue;
        segs.push({ node: child, start: text.length, len: 1, kind: 'br' });
        text += '\n';
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        if (isBlock(child) && text.length > 0 && !text.endsWith('\n')) {
          segs.push({ node: child, start: text.length, len: 1, kind: 'block' });
          text += '\n';
        }
        visit(child);
      }
    }
  };
  visit(root);
  return { text, segs };
}

export function pointToOffset(model: CEModel, root: HTMLElement, container: Node, offset: number): number {
  if (container.nodeType === Node.TEXT_NODE) {
    const seg = model.segs.find((s) => s.node === container);
    if (seg) return seg.start + Math.min(offset, seg.len);
  }
  if (!root.contains(container)) return model.text.length;
  const point = document.createRange();
  point.setStart(container, offset);
  point.collapse(true);
  for (const seg of model.segs) {
    // A block's leading newline lies before any point inside that block.
    if (seg.kind === 'block' && (seg.node === container || seg.node.contains(container))) continue;
    if (point.comparePoint(seg.node, 0) >= 0) return seg.start;
  }
  return model.text.length;
}

export function offsetToPoint(model: CEModel, root: HTMLElement, offset: number): { node: Node; offset: number } {
  const segs = model.segs;
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i];
    if (seg.kind === 'text') {
      if (offset >= seg.start && offset <= seg.start + seg.len) return { node: seg.node, offset: offset - seg.start };
      continue;
    }
    if (offset === seg.start) return before(seg.node);
    if (offset === seg.start + seg.len) {
      const next = segs[i + 1];
      if (next && next.start === offset) continue;
      return seg.kind === 'br' ? after(seg.node) : { node: seg.node, offset: 0 };
    }
  }
  return { node: root, offset: root.childNodes.length };
}

function before(node: Node) {
  const parent = node.parentNode!;
  return { node: parent, offset: Array.prototype.indexOf.call(parent.childNodes, node) };
}

function after(node: Node) {
  const p = before(node);
  return { node: p.node, offset: p.offset + 1 };
}
