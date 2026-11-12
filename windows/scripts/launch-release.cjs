const {spawn}=require('node:child_process');
const path=require('node:path');
const executable=path.resolve(__dirname,'../release/win-unpacked/SeekDesk Windows.exe');
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.SEEKDESK_TEST;delete env.SEEKDESK_USER_DATA;delete env.SEEKDESK_DEV_URL;
const child=spawn(executable,[],{stdio:'ignore',detached:true,shell:false,env});
child.unref();
console.log('Opened SeekDesk Windows release');
