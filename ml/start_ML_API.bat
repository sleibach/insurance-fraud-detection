@echo off
cd src
..\env\Scripts\python.exe -m uvicorn main:app
