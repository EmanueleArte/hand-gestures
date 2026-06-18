type Props = {
  videoRef: React.RefObject<HTMLVideoElement | null>
  canvasRef: React.RefObject<HTMLCanvasElement | null>
}

export function VideoCanvas({ videoRef, canvasRef }: Props) {
  return (
    <div className="relative w-full max-w-2xl rounded-xl overflow-hidden border border-slate-700 bg-black">
      <video
        ref={videoRef}
        className="w-full block [transform:scaleX(-1)]"
        muted
        playsInline
      />
      <canvas
        ref={canvasRef}
        className="absolute top-0 left-0 w-full h-full [transform:scaleX(-1)] pointer-events-none"
      />
    </div>
  )
}
