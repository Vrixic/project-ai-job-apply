/* Linux-only Node N-API primitive. A single material-bearing process owns one session.
 * Kernel SIGKILL deadlines survive a blocked event loop and SIGSTOP. They are not provider
 * settlement, task STOPPED, or an all-copy purge receipt. No content, logging, file or IPC port. */
#define _POSIX_C_SOURCE 200809L
#include <node_api.h>
#include <math.h>
#include <signal.h>
#include <stdatomic.h>
#include <stdint.h>
#include <stdlib.h>
#include <sys/prctl.h>
#include <sys/resource.h>
#include <time.h>
#include <unistd.h>

static timer_t mono_timer, real_timer;
static int bound;
static atomic_int initialized;
static int64_t boot_real, boot_mono, boot_deadline;
enum { BOOT_MS = 60000, MATERIAL_MS = 1800000 };

static void die(void) {
  kill(getpid(), SIGKILL);
  _exit(125);
}

static int64_t now_ms(clockid_t clock) {
  struct timespec value;
  if (clock_gettime(clock, &value) != 0) die();
  return (int64_t)value.tv_sec * 1000 + value.tv_nsec / 1000000;
}

static void arm(timer_t timer, int64_t absolute_ms) {
  struct itimerspec value = {0};
  value.it_value.tv_sec = absolute_ms / 1000;
  value.it_value.tv_nsec = (absolute_ms % 1000) * 1000000;
  if (timer_settime(timer, TIMER_ABSTIME, &value, NULL) != 0) die();
}

static int64_t integer(napi_env env, napi_value input) {
  double value;
  if (napi_get_value_double(env, input, &value) != napi_ok || !isfinite(value) ||
      value < 1 || value > 9007199254740991.0 || floor(value) != value) die();
  return (int64_t)value;
}

static napi_value undefined(napi_env env) {
  napi_value value;
  if (napi_get_undefined(env, &value) != napi_ok) die();
  return value;
}

static napi_value shorten_boot(napi_env env, napi_callback_info info) {
  size_t count = 2;
  napi_value args[2];
  if (napi_get_cb_info(env, info, &count, args, NULL, NULL) != napi_ok || count != 1 || bound) die();
  int64_t duration = integer(env, args[0]);
  int64_t mono = now_ms(CLOCK_MONOTONIC), real = now_ms(CLOCK_REALTIME);
  if (duration > BOOT_MS || mono >= boot_deadline || mono + duration > boot_deadline ||
      real < boot_real || real >= boot_real + BOOT_MS) die();
  boot_deadline = mono + duration;
  arm(mono_timer, boot_deadline);
  arm(real_timer, real + duration);
  return undefined(env);
}

static napi_value bind_completion(napi_env env, napi_callback_info info) {
  size_t count = 3;
  napi_value args[3];
  if (napi_get_cb_info(env, info, &count, args, NULL, NULL) != napi_ok || count != 2 || bound) die();
  int64_t completed = integer(env, args[0]), duration = integer(env, args[1]);
  int64_t mono = now_ms(CLOCK_MONOTONIC), real = now_ms(CLOCK_REALTIME);
  if (duration > MATERIAL_MS || mono >= boot_deadline || real < boot_real ||
      completed < boot_real || completed > real || completed + duration <= real) die();
  int64_t remaining = completed + duration - real;
  /* Realtime forward jumps expire early; the monotonic ceiling prevents backward extension. */
  bound = 1;
  arm(mono_timer, mono + remaining);
  arm(real_timer, completed + duration);
  return undefined(env);
}

static napi_value terminate(napi_env env, napi_callback_info info) {
  (void)env; (void)info;
  die();
  return NULL;
}

static napi_value initialize(napi_env env, napi_value exports) {
  if (atomic_exchange(&initialized, 1)) die();
  struct rlimit core = {0, 0};
  struct sigevent event = {0};
  if (setrlimit(RLIMIT_CORE, &core) != 0 || prctl(PR_SET_DUMPABLE, 0) != 0) die();
  event.sigev_notify = SIGEV_SIGNAL;
  event.sigev_signo = SIGKILL;
  if (timer_create(CLOCK_MONOTONIC, &event, &mono_timer) != 0 ||
      timer_create(CLOCK_REALTIME, &event, &real_timer) != 0) die();
  boot_real = now_ms(CLOCK_REALTIME);
  boot_mono = now_ms(CLOCK_MONOTONIC);
  boot_deadline = boot_mono + BOOT_MS;
  arm(mono_timer, boot_deadline);
  arm(real_timer, boot_real + BOOT_MS);
  napi_property_descriptor properties[] = {
    {"shortenBoot", NULL, shorten_boot, NULL, NULL, NULL, napi_default, NULL},
    {"bindCompletion", NULL, bind_completion, NULL, NULL, NULL, napi_default, NULL},
    {"terminate", NULL, terminate, NULL, NULL, NULL, napi_default, NULL}
  };
  if (napi_define_properties(env, exports, 3, properties) != napi_ok) die();
  return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME, initialize)
