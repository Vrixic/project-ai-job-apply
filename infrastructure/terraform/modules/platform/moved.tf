# Preserve existing active-environment objects when the singleton resources gain the conditional
# index used by the on-demand staging data plane.
moved {
  from = aws_db_instance.postgres
  to   = aws_db_instance.postgres[0]
}

moved {
  from = aws_secretsmanager_secret_version.database_url
  to   = aws_secretsmanager_secret_version.database_url[0]
}

moved {
  from = aws_cloudwatch_metric_alarm.database_cpu
  to   = aws_cloudwatch_metric_alarm.database_cpu[0]
}

moved {
  from = aws_cloudwatch_metric_alarm.database_free_storage
  to   = aws_cloudwatch_metric_alarm.database_free_storage[0]
}
