import { crawlPolicyKnowledge } from "@/core/knowledge/crawler";

function getArgValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

const sourceArg = getArgValue("source");
const maxPagesArg = getArgValue("max-pages");

const summary = await crawlPolicyKnowledge({
  outputDir: getArgValue("out"),
  sourceIds: sourceArg ? sourceArg.split(",").map((value) => value.trim()) : undefined,
  maxPagesPerSource: maxPagesArg ? Number(maxPagesArg) : undefined,
  reset: process.argv.includes("--reset"),
  dryRun: process.argv.includes("--dry-run"),
});

console.log(JSON.stringify(summary, null, 2));
