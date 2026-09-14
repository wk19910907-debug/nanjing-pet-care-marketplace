#!/usr/bin/env bash

trial_restore_valid_db() {
  [[ ${1:-} =~ ^petcare_restore_[0-9]{14}_[0-9]{1,10}$ ]]
}
