import * as pdfjsLib from 'pdfjs-dist'

// new URL(..., import.meta.url) is the Vite-safe way to reference assets
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).href

export async function loadPdfPages(file: File): Promise<string[]> {
  const data        = await file.arrayBuffer()
  const loadingTask = pdfjsLib.getDocument({ data })
  const pdf         = await loadingTask.promise
  const urls: string[] = []

  for (let i = 1; i <= pdf.numPages; i++) {
    const page     = await pdf.getPage(i)
    const viewport = page.getViewport({ scale: 1.5 })
    const canvas   = document.createElement('canvas')
    canvas.width   = viewport.width
    canvas.height  = viewport.height
    const ctx      = canvas.getContext('2d')!
    await page.render({ canvas, canvasContext: ctx, viewport }).promise
    urls.push(canvas.toDataURL('image/jpeg', 0.92))
    page.cleanup()
  }

  await loadingTask.destroy()
  return urls
}
