export default function GlowBackground() {
  return (
    <div className="fixed inset-0 -z-50 overflow-hidden bg-[#0d0f12] select-none">
      <div className="absolute -top-[15%] -right-[15%] w-[90%] h-[65%] rounded-full bg-[#521320]/40 blur-[90px] animate-glow-1" />
      <div className="absolute -bottom-[15%] -left-[15%] w-[90%] h-[65%] rounded-full bg-[#0c351a]/40 blur-[90px] animate-glow-2" />
    </div>
  );
}
