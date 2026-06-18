import JSZip from 'jszip'

const SLIDE_W_EMU = 9144000
const SLIDE_H_EMU = 6858000
const OUT_W = 960
const OUT_H  = 720

function emuX(v: number) { return (v / SLIDE_W_EMU) * OUT_W }
function emuY(v: number) { return (v / SLIDE_H_EMU) * OUT_H }
function n(el: Element | null | undefined, attr: string) {
  return parseInt(el?.getAttribute(attr) ?? '0', 10)
}

// Strip XML namespace prefixes so querySelector works without namespace API
function stripNs(xml: string): string {
  return xml
    .replace(/<(\/?)[a-z][a-z0-9]*:/gi, '<$1')
    .replace(/\s[a-z][a-z0-9]*:([a-zA-Z][a-zA-Z0-9]*)=/g, ' $1=')
}

async function drawZipImage(
  ctx: CanvasRenderingContext2D,
  zip: JSZip,
  path: string,
  x: number, y: number, w: number, h: number,
): Promise<void> {
  const entry = zip.file(path)
  if (!entry) return
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  if (ext === 'emf' || ext === 'wmf') return   // not browser-renderable
  const mimes: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
    gif: 'image/gif', svg: 'image/svg+xml',
  }
  const mime = mimes[ext] ?? 'image/png'
  const blob = new Blob([await entry.async('arraybuffer')], { type: mime })
  const url  = URL.createObjectURL(blob)
  await new Promise<void>(resolve => {
    const img = new Image()
    img.onload  = () => { ctx.drawImage(img, x, y, w, h); URL.revokeObjectURL(url); resolve() }
    img.onerror = () => { URL.revokeObjectURL(url); resolve() }
    img.src = url
  })
}

function relToAbs(rel: string): string {
  return rel.startsWith('../') ? 'ppt/' + rel.slice(3) : 'ppt/slides/' + rel
}

async function renderSlide(zip: JSZip, idx: number): Promise<string> {
  const raw     = await zip.file(`ppt/slides/slide${idx}.xml`)?.async('text') ?? ''
  const relsRaw = await zip.file(`ppt/slides/_rels/slide${idx}.xml.rels`)?.async('text') ?? ''

  const parser = new DOMParser()
  const doc    = parser.parseFromString(stripNs(raw), 'text/xml')

  const rels: Record<string, string> = {}
  if (relsRaw) {
    for (const r of Array.from(
      parser.parseFromString(stripNs(relsRaw), 'text/xml').querySelectorAll('Relationship')
    )) rels[r.getAttribute('Id') ?? ''] = r.getAttribute('Target') ?? ''
  }

  const canvas   = document.createElement('canvas')
  canvas.width   = OUT_W
  canvas.height  = OUT_H
  const ctx      = canvas.getContext('2d')!

  // Default white background
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, OUT_W, OUT_H)

  // Slide background color
  const bgClr = doc.querySelector('bg solidFill srgbClr')
  if (bgClr) {
    ctx.fillStyle = `#${bgClr.getAttribute('val') ?? 'ffffff'}`
    ctx.fillRect(0, 0, OUT_W, OUT_H)
  }

  // Slide background image
  const bgBlip = doc.querySelector('bg bgPr blipFill blip')
  if (bgBlip) {
    const rid = bgBlip.getAttribute('embed')
    if (rid && rels[rid]) await drawZipImage(ctx, zip, relToAbs(rels[rid]), 0, 0, OUT_W, OUT_H)
  }

  const spTree = doc.querySelector('spTree')
  if (!spTree) return canvas.toDataURL('image/jpeg', 0.92)

  // Pictures (behind text)
  for (const pic of Array.from(spTree.querySelectorAll('pic'))) {
    const rid = pic.querySelector('blipFill blip')?.getAttribute('embed')
    if (!rid || !rels[rid]) continue

    const xfrm = pic.querySelector('xfrm')
    const off  = xfrm?.querySelector('off')
    const ext  = xfrm?.querySelector('ext')
    if (!off || !ext) continue

    await drawZipImage(
      ctx, zip, relToAbs(rels[rid]),
      emuX(n(off, 'x')), emuY(n(off, 'y')),
      emuX(n(ext, 'cx')), emuY(n(ext, 'cy')),
    )
  }

  // Text shapes (on top)
  for (const sp of Array.from(spTree.querySelectorAll('sp'))) {
    const txBody = sp.querySelector('txBody')
    if (!txBody) continue

    const xfrm = sp.querySelector('xfrm')
    const off  = xfrm?.querySelector('off')
    const ext  = xfrm?.querySelector('ext')
    if (!off || !ext) continue

    const x = emuX(n(off, 'x'))
    const y = emuY(n(off, 'y'))
    const w = emuX(n(ext, 'cx'))
    const h = emuY(n(ext, 'cy'))

    // Shape fill
    const bgSolid = sp.querySelector('spPr solidFill srgbClr')
    if (bgSolid) {
      ctx.fillStyle = `#${bgSolid.getAttribute('val')}`
      ctx.fillRect(x, y, w, h)
    }

    let curY = y + 6
    for (const para of Array.from(txBody.querySelectorAll('p'))) {
      let lineText = ''
      let fontSize = 18
      let bold     = false
      let color    = '#000000'

      for (const run of Array.from(para.querySelectorAll('r'))) {
        const rPr = run.querySelector('rPr')
        if (rPr) {
          const sz = rPr.getAttribute('sz')
          if (sz) fontSize = Math.max(8, Math.min(72, parseInt(sz, 10) / 100))
          bold  = rPr.getAttribute('b') === '1'
          const clr = rPr.querySelector('solidFill srgbClr')
          if (clr) color = `#${clr.getAttribute('val')}`
        }
        lineText += run.querySelector('t')?.textContent ?? ''
      }

      if (lineText.trim()) {
        ctx.font      = `${bold ? 'bold ' : ''}${fontSize}px sans-serif`
        ctx.fillStyle = color
        ctx.fillText(lineText, x + 4, curY + fontSize, w - 8)
        curY += fontSize * 1.4
      } else {
        curY += fontSize * 0.7
      }

      if (curY > y + h) break
    }
  }

  return canvas.toDataURL('image/jpeg', 0.92)
}

export async function loadPptxSlides(file: File): Promise<string[]> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer())
  let count = 0
  while (zip.file(`ppt/slides/slide${count + 1}.xml`)) count++
  if (count === 0) return []

  const urls: string[] = []
  for (let i = 1; i <= count; i++) urls.push(await renderSlide(zip, i))
  return urls
}
