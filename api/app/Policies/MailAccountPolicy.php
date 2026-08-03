<?php

namespace App\Policies;

use App\Models\MailAccount;
use App\Models\User;

class MailAccountPolicy
{
    public function view(User $user, MailAccount $account): bool
    {
        return $user->id === $account->user_id;
    }

    public function update(User $user, MailAccount $account): bool
    {
        return $user->id === $account->user_id;
    }

    public function delete(User $user, MailAccount $account): bool
    {
        return $user->id === $account->user_id;
    }
}