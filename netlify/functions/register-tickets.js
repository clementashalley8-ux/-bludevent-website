const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

exports.handler = async (event) => {
  const headers = {
    "Content-Type": "application/json",
    "Cache-Control": "no-store"
  };

  const respond = (statusCode, data) => ({
    statusCode,
    headers,
    body: JSON.stringify(data)
  });

  if (event.httpMethod !== "POST") {
    return respond(405, {
      message: "POST requests only."
    });
  }

  try {
    // Require an authenticated staff member.
    const authorization = event.headers.authorization || "";
    const match = authorization.match(/^Bearer (.+)$/);

    if (!match) {
      return respond(401, {
        message: "Authentication required."
      });
    }

    const user = await admin.auth().verifyIdToken(match[1]);

    if (!user.email || user.email_verified !== true) {
      return respond(403, {
        message: "A verified staff email is required."
      });
    }

    const staffEmails = (process.env.STAFF_EMAILS || "")
      .split(",")
      .map(email => email.trim().toLowerCase())
      .filter(Boolean);

    if (!staffEmails.includes(user.email.toLowerCase())) {
      return respond(403, {
        message: "You are not authorized to register tickets."
      });
    }

    // Validate the submitted ticket codes.
    const body = JSON.parse(event.body || "{}");
    const codes = body.codes;

    if (
      !Array.isArray(codes) ||
      codes.length < 1 ||
      codes.length > 400
    ) {
      return respond(400, {
        message: "Submit between 1 and 400 ticket codes."
      });
    }

    if (
      !codes.every(
        code =>
          typeof code === "string" &&
          /^BLU26-[A-Z0-9]{6}$/.test(code)
      )
    ) {
      return respond(400, {
        message: "One or more ticket codes have an invalid format."
      });
    }

    if (new Set(codes).size !== codes.length) {
      return respond(400, {
        message: "Duplicate codes were submitted."
      });
    }

    // Use the code as the document ID, matching the demo ticket.
    const references = codes.map(code =>
      db.collection("tickets").doc(code)
    );

    const existingDocuments = await db.getAll(...references);

    const existingCodes = existingDocuments
      .filter(document => document.exists)
      .map(document => document.id);

    if (existingCodes.length > 0) {
      return respond(409, {
        message: "Some ticket codes already exist. Nothing was added.",
        existingCodes
      });
    }

    // Create all tickets together without overwriting existing documents.
    const batch = db.batch();

    references.forEach((reference, index) => {
      batch.create(reference, {
        ticketCode: codes[index],
        used: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
    });

    await batch.commit();

    return respond(200, {
      success: true,
      registered: codes.length,
      message: "Tickets registered successfully."
    });

  } catch (error) {
    console.error("Ticket registration failed:", error);

    return respond(500, {
      message: "Registration failed. Check the server logs."
    });
  }
};