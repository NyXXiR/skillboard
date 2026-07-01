export function displayCommand(argv) {
  return argv.map(shellQuote).join(" ");
}

function shellQuote(value) {
  return /^[A-Za-z0-9_./:=@-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`;
}
