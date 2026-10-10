import { discoverSaipen, invokeSaipen } from './lib/saipen.mjs';
const args=process.argv.slice(2);
const runtime=discoverSaipen();
if (!args.length || args[0]==='doctor') {
  console.log(JSON.stringify(runtime,null,2));
  process.exitCode=runtime.available?0:2;
} else {
  const result=invokeSaipen(args,{discovery:runtime});
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exitCode=result.status ?? 1;
}
