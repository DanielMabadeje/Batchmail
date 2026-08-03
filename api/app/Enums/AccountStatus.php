<?php

namespace App\Enums;

enum AccountStatus: string
{
    case Active = 'active';
    case Paused = 'paused';
    case Throttled = 'throttled';
    case Revoked = 'revoked';
}