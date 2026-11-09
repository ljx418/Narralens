/** Same MCP facade, using private runtime discovery and refreshed credentials per request. */
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {createHostApplicationPorts,HostCallError} from '../src/mcp/host-application-ports.js';
import {createMcpServer} from '../src/mcp/mcp-server.js';
import {runtimeRoot,readRuntimeConnection} from '../src/host/agent-driven/owned-runtime.js';
async function main(){
 const args=process.argv.slice(2);if(args.length!==2||args[0]!=='--root')throw new Error('INVALID_RUNTIME_ROOT');
 const root=runtimeRoot(args[1]!),connection=readRuntimeConnection(root);if(!connection)throw new Error('INSTANCE_NOT_READY');
 const ports=createHostApplicationPorts({baseUrl:connection.origin,headers:()=>{
  try{const current=readRuntimeConnection(root);
   if(!current||current.instance_id!==connection.instance_id||current.generation!==connection.generation||current.origin!==connection.origin)throw new Error('RECONNECT_REPLACED_INSTANCE');
   return {Authorization:'Bearer '+current.token};
  }catch{throw new HostCallError({schema_version:'agent.v1',correlation_id:'private-runtime-connection',code:'UNAUTHORIZED',http_status:401,message:'运行实例或凭据已更新，请重新连接',retryable:false,next_actions:['reconnect_authorized_instance']});}
 }});
 const server=createMcpServer({ports});
 for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>{void server.close().finally(()=>process.exit(0));});
 await server.connect(new StdioServerTransport());
}
void main().catch(()=>{process.stderr.write('NARRALENS_MCP_RUNTIME_UNAVAILABLE\n');process.exitCode=1;});
