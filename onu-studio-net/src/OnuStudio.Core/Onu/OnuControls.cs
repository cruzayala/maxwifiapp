using Microsoft.Playwright;

namespace OnuStudio.Core.Onu;

/// <summary>
/// Escritura defensiva de los formularios de la ONU: antes de cambiar algo se
/// comprueba que el campo exista, se pueda editar y conserve el valor.
/// Si el firmware bloquea un campo obligatorio, se detiene en vez de seguir a ciegas.
/// </summary>
public static class OnuControls
{
    public static OnuProvisioningException LockedField(string selector, object? current, object? desired) =>
        new($"El campo {selector} esta bloqueado por el firmware: valor actual {current}, solicitado {desired}",
            "ONU_IMMUTABLE_FIELD_CONFLICT", retryable: false);

    public static async Task<bool> SetCheckedAsync(IBrowserScope scope, string selector, bool checkedValue, bool required = false)
    {
        var control = scope.Locator(selector);
        if (await control.CountAsync() != 1)
        {
            if (required) throw new OnuProvisioningException($"Campo requerido no encontrado: {selector}", "ONU_REQUIRED_CONTROL_MISSING");
            return false;
        }

        await control.WaitForAsync(new LocatorWaitForOptions { State = WaitForSelectorState.Attached, Timeout = 4000 });
        var current = await control.IsCheckedAsync();
        if (!await control.IsVisibleAsync() || !await control.IsEnabledAsync())
        {
            if (current == checkedValue) return false;
            if (required) throw LockedField(selector, current, checkedValue);
            return false;
        }

        await control.SetCheckedAsync(checkedValue, new LocatorSetCheckedOptions { Timeout = 4000 });
        if (await control.IsCheckedAsync() != checkedValue)
            throw new OnuProvisioningException($"La ONU no conservo el valor de {selector}");
        return current != checkedValue;
    }

    public static async Task<bool> FillAsync(IBrowserScope scope, string selector, string value, bool required = true)
    {
        var control = scope.Locator(selector);
        if (await control.CountAsync() != 1)
        {
            if (required) throw new OnuProvisioningException($"Campo requerido no encontrado: {selector}", "ONU_REQUIRED_CONTROL_MISSING");
            return false;
        }

        await control.WaitForAsync(new LocatorWaitForOptions { State = WaitForSelectorState.Attached, Timeout = 4000 });
        var current = await control.InputValueAsync(new LocatorInputValueOptions { Timeout = 2000 });
        var readOnly = await control.EvaluateAsync<bool>("element => Boolean(element.disabled || element.readOnly)");

        if (!await control.IsVisibleAsync() || !await control.IsEnabledAsync() || readOnly)
        {
            if (current == value) return false;
            if (required) throw LockedField(selector, current, value);
            return false;
        }
        if (current == value) return false;

        await control.FillAsync(value, new LocatorFillOptions { Timeout = 4000 });
        if (await control.InputValueAsync(new LocatorInputValueOptions { Timeout = 2000 }) != value)
            throw new OnuProvisioningException($"La ONU no conservo el valor de {selector}");
        return true;
    }

    public static async Task<bool> SelectAsync(IBrowserScope scope, string selector, string value, bool required = false)
    {
        var control = scope.Locator(selector);
        if (await control.CountAsync() != 1)
        {
            if (required) throw new OnuProvisioningException($"Campo requerido no encontrado: {selector}", "ONU_REQUIRED_CONTROL_MISSING");
            return false;
        }

        await control.WaitForAsync(new LocatorWaitForOptions { State = WaitForSelectorState.Attached, Timeout = 4000 });
        var values = await control.Locator("option").EvaluateAllAsync<string[]>("options => options.map(option => option.value)");
        if (!values.Contains(value))
        {
            if (required)
                throw new OnuProvisioningException(
                    $"La ONU no admite el valor {value} en {selector}", "ONU_UNSUPPORTED_CONTROL_VALUE", retryable: false);
            return false;
        }

        var current = await control.InputValueAsync(new LocatorInputValueOptions { Timeout = 2000 });
        var readOnly = await control.EvaluateAsync<bool>("element => Boolean(element.disabled || element.readOnly)");
        if (!await control.IsVisibleAsync() || !await control.IsEnabledAsync() || readOnly)
        {
            if (current == value) return false;
            if (required) throw LockedField(selector, current, value);
            return false;
        }
        if (current == value) return false;

        await control.SelectOptionAsync(new[] { new SelectOptionValue { Value = value } }, new LocatorSelectOptionOptions { Timeout = 4000 });
        if (await control.InputValueAsync(new LocatorInputValueOptions { Timeout = 2000 }) != value)
            throw new OnuProvisioningException($"La ONU no conservo el valor de {selector}");
        return true;
    }

    public static async Task<string> InputValueAsync(IBrowserScope scope, string selector, float timeout = 2000) =>
        await scope.Locator(selector).InputValueAsync(new LocatorInputValueOptions { Timeout = timeout });

    public static async Task<bool> IsCheckedAsync(IBrowserScope scope, string selector)
    {
        var control = scope.Locator(selector);
        return await control.CountAsync() == 1 && await control.IsCheckedAsync();
    }

    /// <summary>Hace clic en el primer elemento visible con ese texto exacto.</summary>
    public static async Task<bool> ClickVisibleExactTextAsync(IBrowserScope scope, string text)
    {
        foreach (var candidate in await scope.GetByText(text).AllAsync())
        {
            if (!await candidate.IsVisibleAsync() || !await candidate.IsEnabledAsync()) continue;
            await candidate.ClickAsync();
            return true;
        }
        return false;
    }
}
