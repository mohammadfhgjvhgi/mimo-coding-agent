#!/bin/bash
# Double-fork daemon pattern to fully detach from parent process
cd /home/z/my-project

# First fork
(
  # Second fork  
  (
    exec node node_modules/next/dist/bin/next dev -p 3000
  ) </dev/null >/home/z/my-project/dev.log 2>&1 &
  echo $! > /home/z/my-project/.zscripts/dev.pid
  exit 0
) &
exit 0
