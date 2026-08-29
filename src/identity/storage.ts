import { parseIdentityBackup, type EncryptedIdentity } from "./vault";

const DATABASE = "agent-guild-local";
const STORE = "encrypted-identities";
const ACTIVE_ID = "active";

export async function loadLocalIdentity(): Promise<EncryptedIdentity | null> {
  const database = await openDatabase();
  try {
    const stored = await requestToPromise<unknown>(database.transaction(STORE, "readonly").objectStore(STORE).get(ACTIVE_ID));
    return stored ? parseIdentityBackup(JSON.stringify(stored)) : null;
  } finally {
    database.close();
  }
}

export async function saveLocalIdentity(identity: EncryptedIdentity): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE, "readwrite");
    transaction.objectStore(STORE).put(identity, ACTIVE_ID);
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

export async function deleteLocalIdentity(): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE, "readwrite");
    transaction.objectStore(STORE).delete(ACTIVE_ID);
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE);
      }
      if (!request.result.objectStoreNames.contains("contribution-ledger")) {
        request.result.createObjectStore("contribution-ledger");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open the local identity vault."));
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Local identity storage failed."));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Local identity storage failed."));
    transaction.onabort = () => reject(transaction.error ?? new Error("Local identity storage was interrupted."));
  });
}
