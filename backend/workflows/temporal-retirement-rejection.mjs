const GRPC_PERMISSION_DENIED = 7;
const GRPC_UNAUTHENTICATED = 16;

export function isProviderAccessRejected(error) {
  if (typeof error !== "object" || error === null) return false;
  return (
    error.code === GRPC_PERMISSION_DENIED ||
    error.code === "PERMISSION_DENIED" ||
    error.code === GRPC_UNAUTHENTICATED ||
    error.code === "UNAUTHENTICATED"
  );
}
