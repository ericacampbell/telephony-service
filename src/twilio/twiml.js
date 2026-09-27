const escapeXml = (s) =>
  String(s ?? '').replace(/[<>&'"]/g, (c) =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c],
  );

const doc = (inner) => `<?xml version="1.0" encoding="UTF-8"?>\n<Response>${inner}</Response>`;

const VOICE = 'Polly.Amy-Neural';

/** Greeting, then record the caller. Twilio POSTs `action` when recording ends. */
export function intakeTwiml({ greeting, actionUrl, maxLengthSec = 120 }) {
  return doc(
    `<Say voice="${VOICE}">${escapeXml(greeting)}</Say>` +
      `<Record action="${escapeXml(actionUrl)}" method="POST"` +
      ` maxLength="${maxLengthSec}" playBeep="true" trim="trim-silence"` +
      ` timeout="4" finishOnKey="#"/>` +
      // Reached only if the caller never speaks and Record times out.
      `<Say voice="${VOICE}">Sorry, I did not catch that. Goodbye.</Say><Hangup/>`,
  );
}

/** Bridge to the receiving agent, whispering the brief to them on answer. */
export function dialWithWhisperTwiml({ to, whisperUrl, callerId, holdMessage, timeoutSec = 25, actionUrl }) {
  return doc(
    (holdMessage ? `<Say voice="${VOICE}">${escapeXml(holdMessage)}</Say>` : '') +
      `<Dial timeout="${timeoutSec}"${callerId ? ` callerId="${escapeXml(callerId)}"` : ''}` +
      `${actionUrl ? ` action="${escapeXml(actionUrl)}" method="POST"` : ''}>` +
      `<Number url="${escapeXml(whisperUrl)}" method="POST">${escapeXml(to)}</Number>` +
      `</Dial>`,
  );
}

/** Played to the answering agent before the two legs are bridged. */
export function whisperTwiml({ brief }) {
  if (!brief) {
    return doc(`<Say voice="${VOICE}">Connecting a caller. No brief is available.</Say>`);
  }
  const risks = (brief.risk_flags || []).filter((f) => f !== 'none');
  return doc(
    `<Say voice="${VOICE}">` +
      `Incoming transfer. ${escapeXml(brief.reason)}. ` +
      `Caller sounds ${escapeXml(brief.sentiment?.label || 'neutral')}. ` +
      (risks.length ? `Flags: ${escapeXml(risks.join(', ').replace(/_/g, ' '))}. ` : '') +
      `Open with: ${escapeXml(brief.first_line)}` +
      `</Say>`,
  );
}

export function sayAndHangupTwiml(message) {
  return doc(`<Say voice="${VOICE}">${escapeXml(message)}</Say><Hangup/>`);
}

export function voicemailTwiml({ message, actionUrl }) {
  return doc(
    `<Say voice="${VOICE}">${escapeXml(message)}</Say>` +
      `<Record action="${escapeXml(actionUrl)}" method="POST" maxLength="120" playBeep="true"/>`,
  );
}
