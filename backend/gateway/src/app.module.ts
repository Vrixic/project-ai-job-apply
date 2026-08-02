import {
  type ArgumentsHost,
  Catch,
  Controller,
  type DynamicModule,
  type ExceptionFilter,
  Get,
  Headers,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Module,
  Param,
  Put,
  Req,
  UseFilters,
} from "@nestjs/common";
import type {
  CurrentUser,
  Operation,
  ProblemDetails,
  PutJobPreferencesRequest,
  PutJobPreferencesResponse,
} from "@ai-job-apply/api-contracts";
import { compileComponentValidator, formatValidationErrors } from "@ai-job-apply/api-contracts";
import { type AccessTokenVerifier, AuthenticationError, bearerToken } from "@ai-job-apply/auth";
import { activeTraceparent, correlationId } from "@ai-job-apply/observability";
import { IdempotencyConflictError, type ProfileStore } from "@ai-job-apply/profile-service";
import type { FastifyReply, FastifyRequest } from "fastify";

const PROFILE_STORE = Symbol("PROFILE_STORE");
const TOKEN_VERIFIER = Symbol("TOKEN_VERIFIER");
const RELEASE_SHA = Symbol("RELEASE_SHA");

interface AuthenticatedRequest extends FastifyRequest {
  traceId?: string;
}

@Injectable()
class RequestIdentity {
  constructor(
    @Inject(TOKEN_VERIFIER) private readonly verifier: AccessTokenVerifier,
    @Inject(PROFILE_STORE) private readonly store: ProfileStore,
  ) {}

  async resolve(
    request: AuthenticatedRequest,
    requiredScope: "profile:read" | "profile:write",
  ): Promise<CurrentUser> {
    const token = bearerToken(request.headers.authorization);
    const principal = await this.verifier.verify(token);
    if (!principal.scopes.includes(requiredScope)) {
      throw new HttpException("Required permission is missing", HttpStatus.FORBIDDEN);
    }
    return this.store.resolveUser(principal, request.traceId ?? correlationId(undefined));
  }
}

@Catch()
class ProblemDetailsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<AuthenticatedRequest>();
    const response = context.getResponse<FastifyReply>();
    const traceId = request.traceId ?? correlationId(undefined);

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = "internal_error";
    let title = "Internal server error";
    let detail: string | undefined;

    if (exception instanceof AuthenticationError) {
      status = HttpStatus.UNAUTHORIZED;
      code = "authentication_required";
      title = "Authentication required";
      detail = exception.message;
    } else if (exception instanceof IdempotencyConflictError) {
      status = HttpStatus.CONFLICT;
      code = "idempotency_conflict";
      title = "Idempotency key conflict";
      detail = exception.message;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      code =
        status === HttpStatus.NOT_FOUND
          ? "not_found"
          : status === HttpStatus.FORBIDDEN
            ? "forbidden"
            : status === HttpStatus.BAD_REQUEST
              ? "invalid_request"
              : "request_error";
      title = HttpStatus[status] ?? "Request error";
      detail = exception.message;
    }

    const problem: ProblemDetails = {
      type: `urn:ai-job-apply:problem:${code}`,
      title,
      status,
      code,
      traceId,
      ...(detail ? { detail } : {}),
    };
    void response
      .header("cache-control", "no-store")
      .status(status)
      .type("application/problem+json")
      .send(problem);
  }
}

@Controller()
@UseFilters(ProblemDetailsFilter)
class HealthController {
  constructor(
    @Inject(PROFILE_STORE) private readonly store: ProfileStore,
    @Inject(RELEASE_SHA) private readonly releaseSha: string,
  ) {}

  @Get("/health/live")
  liveness() {
    return { status: "ok", service: "gateway", releaseSha: this.releaseSha };
  }

  @Get("/health/ready")
  async readiness() {
    try {
      await this.store.ping();
      return { status: "ok", service: "gateway", releaseSha: this.releaseSha };
    } catch {
      throw new HttpException("PostgreSQL is unavailable", HttpStatus.SERVICE_UNAVAILABLE);
    }
  }
}

const validatePreferences = compileComponentValidator("PutJobPreferencesRequest");

@Controller("/v1")
@UseFilters(ProblemDetailsFilter)
class CandidateController {
  constructor(
    @Inject(RequestIdentity) private readonly identity: RequestIdentity,
    @Inject(PROFILE_STORE) private readonly store: ProfileStore,
  ) {}

  @Get("/me")
  async me(@Req() request: AuthenticatedRequest): Promise<CurrentUser> {
    return this.identity.resolve(request, "profile:read");
  }

  @Get("/me/job-preferences")
  async getPreferences(@Req() request: AuthenticatedRequest) {
    const user = await this.identity.resolve(request, "profile:read");
    const preferences = await this.store.getPreferences(user.id);
    if (!preferences) {
      throw new HttpException("Job preferences were not found", HttpStatus.NOT_FOUND);
    }
    return preferences;
  }

  @Put("/me/job-preferences")
  async putPreferences(
    @Req() request: AuthenticatedRequest,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
  ): Promise<PutJobPreferencesResponse> {
    const user = await this.identity.resolve(request, "profile:write");
    if (!idempotencyKey || idempotencyKey.length < 16 || idempotencyKey.length > 128) {
      throw new HttpException(
        "Idempotency-Key must contain 16 to 128 characters",
        HttpStatus.BAD_REQUEST,
      );
    }
    const input = request.body;
    if (!validatePreferences(input)) {
      throw new HttpException(
        formatValidationErrors(validatePreferences.errors),
        HttpStatus.BAD_REQUEST,
      );
    }
    return this.store.putPreferences(
      user.id,
      input as PutJobPreferencesRequest,
      idempotencyKey,
      request.traceId ?? correlationId(undefined),
      activeTraceparent(),
    );
  }

  @Get("/operations/:operationId")
  async getOperation(
    @Req() request: AuthenticatedRequest,
    @Param("operationId") operationId: string,
  ): Promise<Operation> {
    const user = await this.identity.resolve(request, "profile:read");
    const operation = await this.store.getOperation(user.id, operationId);
    if (!operation) {
      throw new HttpException("Operation was not found", HttpStatus.NOT_FOUND);
    }
    return operation;
  }
}

export interface AppModuleOptions {
  store: ProfileStore;
  verifier: AccessTokenVerifier;
  releaseSha: string;
}

@Module({})
// biome-ignore lint/complexity/noStaticOnlyClass: NestJS modules are class-based composition roots.
export class AppModule {
  static register(options: AppModuleOptions): DynamicModule {
    return {
      module: AppModule,
      controllers: [HealthController, CandidateController],
      providers: [
        RequestIdentity,
        { provide: PROFILE_STORE, useValue: options.store },
        { provide: TOKEN_VERIFIER, useValue: options.verifier },
        { provide: RELEASE_SHA, useValue: options.releaseSha },
      ],
    };
  }
}

export async function applyRequestContext(
  request: AuthenticatedRequest,
  reply: FastifyReply,
): Promise<void> {
  request.traceId = correlationId(
    typeof request.headers["x-correlation-id"] === "string"
      ? request.headers["x-correlation-id"]
      : undefined,
  );
  reply.header("x-correlation-id", request.traceId);
}
