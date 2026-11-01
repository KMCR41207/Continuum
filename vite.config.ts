import { defineConfig,loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import {isPrivilegedKey} from './src/lib/publicKey.ts';
export default defineConfig(({mode})=>{
  const env=loadEnv(mode,process.cwd(),'VITE_');
  if(Object.entries(env).some(([name,value])=>/SERVICE_ROLE|SECRET|PRIVATE_KEY/.test(name)||isPrivilegedKey(value)))throw new Error('Privileged credentials must never appear in VITE_ variables. Remove them before building.');
  return {plugins:[react()],server:{port:5173}};
});
