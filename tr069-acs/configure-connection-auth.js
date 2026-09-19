const username = process.env.CRU;
const password = process.env.CRP;

if (!username || !password) {
  throw new Error('Missing protected connection request credentials');
}

const value = `AUTH(${JSON.stringify(username)}, ${JSON.stringify(password)})`;
const result = db.config.updateOne(
  { _id: 'cwmp.connectionRequestAuth' },
  { $set: { value } },
  { upsert: true },
);

printjson({
  acknowledged: result.acknowledged,
  matched: result.matchedCount,
  modified: result.modifiedCount,
  upserted: Boolean(result.upsertedId),
});
