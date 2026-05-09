@echo off
rem Chrome Native Messaging calls this batch file, which runs the Python helper.
rem Passes through all args, keeps stdin/stdout pipes.
python "%~dp0base44_native_helper.py"
