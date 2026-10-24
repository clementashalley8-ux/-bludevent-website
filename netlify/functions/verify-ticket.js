const admin = require("firebase-admin");
const headers = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store"
};
function response(statusCode, message, valid = false) {
  return {
    statusCode,
    headers,
    body: JSON.stringify({ valid, message })
  };
}
function initializeFirebase() {
  if (admin.apps.length) return;
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!serviceAccountJson) {
    throw new Error("Firebase service account is not configured.");
  }
  const serviceAccount = JSON.parse(serviceAccountJson);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}
exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return response(405, "Method not allowed.");
  }
  try {
    initializeFirebase();
    const authorization = event.headers.authorization ||
      event.headers.Authorization || "";
    if (!authorization.startsWith("Bearer ")) {
      return response(401, "Please sign in as authorized staff.");
    }
    const idToken = authorization.slice(7);
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    if (!decodedToken.email || decodedToken.email_verified !== true) {
      return response(403, "A verified staff email is required.");
    }
    const staffEmails = (process.env.STAFF_EMAILS || "")
      .split(",")
      .map(email => email.trim().toLowerCase())
      .filter(Boolean);
    if (!staffEmails.includes(decodedToken.email.toLowerCase())) {
      return response(403, "This account is not authorized to verify tickets.");
    }
    let body;
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return response(400, "Invalid request body.");
    }
    const ticketCode = String(body.ticketCode || "").trim();
    if (!ticketCode || ticketCode.length > 200) {
      return response(400, "Please provide a valid ticket code.");
    }
    const db = admin.firestore();
    const directRef = db.collection("tickets").doc(ticketCode);
    let ticketRef = directRef;
    let ticketSnapshot = await directRef.get();
    if (!ticketSnapshot.exists) {
      const query = await db.collection("tickets")
        .where("ticketCode", "==", ticketCode)
        .limit(1)
        .get();
      if (query.empty) {
        return response(404, "Ticket not found.");
      }
      ticketRef = query.docs[0].ref;
    }
    const result = await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ticketRef);
      if (!snapshot.exists) {
        return { valid: false, message: "Ticket not found." };
      }
      const ticket = snapshot.data();
      if (ticket.used === true || ticket.status === "used") {
        return { valid: false, message: "This ticket has already been used." };
      }
      if (
        ticket.valid === false ||
        ticket.status === "invalid" ||
        ticket.status === "cancelled"
      ) {
        return { valid: false, message: "This ticket is invalid or cancelled." };
      }
      transaction.update(ticketRef, {
        used: true,
        status: "used",
        checkedInAt: admin.firestore.FieldValue.serverTimestamp(),
        checkedInBy: decodedToken.email
      });
      return { valid: true, message: "Ticket verified. Check-in successful." };
    });
    return {
      statusCode: result.valid ? 200 : 400,
      headers,
      body: JSON.stringify(result)
    };
  } catch (error) {
    console.error("Ticket verification failed:", error.message);
    return response(
      500,
      "Verification service error. Please contact the event administrator."
    );
  }
};