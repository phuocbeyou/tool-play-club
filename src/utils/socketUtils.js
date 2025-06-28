// socketUtils.js
export function sendHeartbeat(connection, intervalRef, isCloseRef) {
    let _next_ive = 0;
    intervalRef.current = setInterval(() => {
      if (isCloseRef.current) return clearInterval(intervalRef.current);
      connection.sendUTF(`[7,"Simms",${++_next_ive},0]`);
    }, 5000);
  }
  
  export function sendInitData(connection, username,password,info, signature) {
    const initPayload = [
      1,
      "MiniGame",
      username,
      password,
      {
        info: JSON.stringify(info),
        signature,
      },
    ];
    connection.sendUTF(JSON.stringify(initPayload));
    connection.sendUTF(`[6,"MiniGame","taixiuUnbalancedPlugin",{"cmd":2000}]`);
    setTimeout(() => {
      connection.sendUTF(
        `[6,"MiniGame","taixiuUnbalancedPlugin",{"cmd":2000}]`
      );
    }, 200);
  }
  
  export function handleClose(description, intervals, log) {
    intervals.forEach((interval) => clearInterval(interval.current));
    log("close: " + description.toString());
    return new Error(description);
  }
  
  export function handleError(error, log) {
    log("Error: " + error.toString());
    return new Error(error);
  }
  