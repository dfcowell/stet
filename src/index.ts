// Composition root. Wave 2 (server) wires the pipeline here.
export {};

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log("stet: foundation ready. Server wiring lands in Wave 2.");
}
