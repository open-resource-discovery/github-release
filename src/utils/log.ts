function escapeCommandValue(value: string): string {
  return value.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

export function info(message: string): void {
  process.stdout.write(`${message}\n`);
}

export function notice(message: string): void {
  info(`::notice::${escapeCommandValue(message)}`);
}

export function warning(message: string): void {
  info(`::warning::${escapeCommandValue(message)}`);
}

export function error(message: string): void {
  process.stderr.write(`::error::${escapeCommandValue(message)}\n`);
}

export function addMask(value: string): string {
  if (value !== "") {
    info(`::add-mask::${escapeCommandValue(value)}`);
  }

  return value;
}
