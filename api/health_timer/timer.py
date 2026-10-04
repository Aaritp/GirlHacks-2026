import logging

import azure.functions as func

from health_timer.health import HealthRepository, refresh_health


def create_health_blueprint(repository: HealthRepository) -> func.Blueprint:
    """Register only after the real shared repository implements HealthRepository."""
    bp = func.Blueprint()

    @bp.timer_trigger(schedule="0 0 * * * *", arg_name="timer", run_on_startup=False,
                      use_monitor=True)
    def refresh_seed_health(timer: func.TimerRequest):
        if timer.past_due:
            logging.warning("Seed health timer is running late")
        counts = refresh_health(repository)
        logging.info("Seed health refresh: %s", counts)

    return bp
