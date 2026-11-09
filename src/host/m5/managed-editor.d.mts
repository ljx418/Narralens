export interface VerifiedManagedEditor {readonly directory:string;readonly build_sha256:string;isCurrent():boolean;}
export function prepareManagedEditor(runtimeRoot:string,vendorRoot:string):VerifiedManagedEditor;
export function assertManagedEditor(directory:string,runtimeRoot:string,vendorRoot:string):string;
