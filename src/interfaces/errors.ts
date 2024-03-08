/*
  Full list of mongo errors:
    https://github.com/mongodb/mongo/blob/master/src/mongo/base/error_codes.yml
    https://github.com/mongodb/mongo-c-driver/blob/master/src/libmongoc/src/mongoc/mongoc-error.h
*/

export enum MongoDBErrorCode {
    AlreadyInitialized = 23,
    AuthenticationFailed = 18,
    BadValue = 2,
    CannotMutateObject = 10,
    CannotReuseObject = 19,
    CollectionDoesNotExist = 26,
    DuplicateKey = 11000,
    EmptyArrayOperation = 21,
    FailedToParse = 9,
    GraphContainsCycle = 5,
    HostNotFound = 7,
    HostUnreachable = 6,
    IllegalOperation = 20,
    IndexNotFound = 27,
    InternalError = 1,
    InvalidBson = 22,
    InvalidLength = 16,
    InvalidPath = 30,
    LockTimeout = 24,
    MaxTimeMSExpired = 50,
    NonExistentPath = 29,
    NoSuchKey = 4,
    Overflow = 15,
    PathNotViable = 28,
    ProtocolError = 17,
    QueryCommandNotFound = 59,
    QueryNotTailable = 13051,
    RemoteValidationError = 25,
    TypeMismatch = 14,
    Unauthorized = 13,
    UnknownError = 8,
    UnsupportedFormat = 12,
    UserNotFound = 11,
    WriteConcernError = 64,
}
