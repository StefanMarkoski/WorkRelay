export function JsonView({ value }: { value: unknown }) {
  if (value == null) return <p className="text-xs text-muted-foreground">None recorded</p>
  return (
    <pre className="max-h-64 overflow-auto rounded-md bg-muted p-3 font-mono text-xs">{JSON.stringify(value, null, 2)}</pre>
  )
}
