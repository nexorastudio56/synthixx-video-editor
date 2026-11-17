/** Runtime auditor (runs in the browser): returns every violation of the sharp-text contract for elements under [data-layer=L2]. */
export function auditCrispText(doc: Document, layerId: string = "L2-typography"): string[] { // self-contained: serialisable into page.evaluate
  const bad: string[] = []; const root = doc.querySelector(`[data-layer="${layerId}"]`);
  if (!root) return ["L2 layer missing"];
  const check = (el: Element, label: string) => {
    const cs = getComputedStyle(el);
    if (cs.filter !== "none") bad.push(`${label}: filter=${cs.filter}`);
    const bf = cs.getPropertyValue("backdrop-filter"); if (bf && bf !== "none") bad.push(`${label}: backdrop-filter=${bf}`);
    if (cs.mixBlendMode !== "normal") bad.push(`${label}: mix-blend-mode=${cs.mixBlendMode}`);
    const mk = cs.getPropertyValue("mask-image"); if (mk && mk !== "none") bad.push(`${label}: mask-image`);
  };
  for (let el: Element | null = root; el; el = el.parentElement) check(el, `ancestor<${el.tagName.toLowerCase()}>`);
  root.querySelectorAll("*").forEach(el => check(el, `descendant<${el.tagName.toLowerCase()}>`));
  return bad;
}
