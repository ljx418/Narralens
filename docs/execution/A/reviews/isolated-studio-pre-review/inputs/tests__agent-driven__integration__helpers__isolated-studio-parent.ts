import {startIsolatedStudio} from '../../../../src/host/m5/isolated-studio.js';
const [runtimeRoot,vendorRoot]=process.argv.slice(2);
if(!runtimeRoot||!vendorRoot)throw new Error('Missing test arguments');
const studio=await startIsolatedStudio({runtimeRoot,vendorRoot});
// Never print its private launch key. Parent lifetime is deliberately controlled by test.
process.stdout.write(JSON.stringify({origin:studio.origin,filmOrigin:studio.filmOrigin,pid:studio.childPid})+'\n');
