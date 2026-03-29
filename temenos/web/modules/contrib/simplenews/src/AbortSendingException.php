<?php

namespace Drupal\simplenews;

/**
 * Exception to throw to abort the current batch of sending.
 *
 * Use this when there is a global transport error that means any attempt to
 * send to any address will fail.
 */
class AbortSendingException extends \RuntimeException {

}
