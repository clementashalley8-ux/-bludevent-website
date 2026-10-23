const admin = require(“firebase-admin”);

const headers = {
“Content-Type”: “application/json”,
“Cache-Control”: “no-store”
};

let db;

function getDatabase() {
if (db) return db;

const serviceAccountText = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

if (!serviceAccountText) {
throw new Error(“Firebase service account is not configured.”);
}

const serviceAccount = JSON.parse(serviceAccountText);

if (!admin.apps.length) {
admin.initializeApp({
credential: admin.credential.cert(serviceAccount)
});
}

db = admin.firestore();
return db;
}

exports.handler = async (event) => {
if (event.httpMethod !== “POST”) {
return {
statusCode: 405,
headers,
body: JSON.stringify({ message: “Use POST to verify a ticket.” })
};
}

try {
const body = JSON.parse(event.body || “{}”);
const ticketCode = String(body.ticketCode || body.code || “”).trim();

if (!ticketCode) {
  return {
    statusCode: 400,
    headers,
    body: JSON.stringify({ valid: false, message: "Enter a ticket code." })
  };
}
const firestore = getDatabase();
const ticketRef = firestore.collection("tickets").doc(ticketCode);
const result = await firestore.runTransaction(async (transaction) => {
  let ticketSnapshot = await transaction.get(ticketRef);
  let actualRef = ticketRef;
  if (!ticketSnapshot.exists) {
    const matches = await firestore
      .collection("tickets")
      .where("ticketCode", "==", ticketCode)
      .limit(1)
      .get();
    if (matches.empty) {
      return { valid: false, message: "Invalid ticket." };
    }
    actualRef = matches.docs[0].ref;
    ticketSnapshot = await transaction.get(actualRef);
  }
  if (!ticketSnapshot.exists) {
    return { valid: false, message: "Invalid ticket." };
  }
  const ticket = ticketSnapshot.data();
  if (
    ticket.used === true ||
    ticket.checkedIn === true ||
    ticket.status === "used"
  ) {
    return {
      valid: false,
      message: "This ticket has already been used."
    };
  }
  transaction.update(actualRef, {
    used: true,
    checkedIn: true,
    status: "used",
    checkedInAt: admin.firestore.FieldValue.serverTimestamp()
  });
  return {
    valid: true,
    message: "Ticket verified. Entry approved."
  };
});
return {
  statusCode: result.valid ? 200 : 400,
  headers,
  body: JSON.stringify(result)
};

} catch (error) {
console.error(“Ticket verification error:”, error);

return {
  statusCode: 500,
  headers,
  body: JSON.stringify({
    valid: false,
    message: "Verification service is not configured correctly."
  })
};

}
};
