import React from 'react';
import { useState, useEffect } from 'react';

export default function Clock() {
  const [time, setTime] = useState('');

  function updateClock () {
    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-US', { hour12: false });
    setTime(timeStr);
    console.log(timeStr);
  };

  useEffect(() => {
    console.log('updateClock');
    updateClock();
    const interval = setInterval(updateClock, 1000);

    return () => clearInterval(interval);
  }, []);

  return (
    <span style={{ fontSize: '1rem', fontWeight: 700, color: 'rgb(224, 204, 250)', fontFamily: 'monospace' }}>
        {time}
    </span>
  );
}
