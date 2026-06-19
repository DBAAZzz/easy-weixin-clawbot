export function ParameterChip(props: { name: string }) {
  return (
    <span className="rounded-full border border-line bg-white/78 px-2 py-1 font-mono text-2xs tracking-mono text-muted-strong">
      {props.name}
    </span>
  );
}
