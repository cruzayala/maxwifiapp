using Microsoft.Playwright;

namespace OnuStudio.Core.Onu;

/// <summary>
/// Los paneles de las ONU mezclan paginas y marcos internos. Esta capa deja usar
/// los mismos ayudantes en ambos, igual que hacia el agente anterior.
/// </summary>
public interface IBrowserScope
{
    ILocator Locator(string selector);
    ILocator GetByText(string text, bool exact = true);
    ILocator GetByRole(AriaRole role, string name, bool exact = true);
    Task GotoAsync(string url, float timeout);
    Task<T> EvaluateAsync<T>(string expression, object? argument = null);
    Task WaitForLoadStateAsync(LoadState state, float timeout);
}

public sealed class PageScope : IBrowserScope
{
    public PageScope(IPage page) => Page = page;

    public IPage Page { get; }

    public ILocator Locator(string selector) => Page.Locator(selector);

    public ILocator GetByText(string text, bool exact = true) =>
        Page.GetByText(text, new PageGetByTextOptions { Exact = exact });

    public ILocator GetByRole(AriaRole role, string name, bool exact = true) =>
        Page.GetByRole(role, new PageGetByRoleOptions { Name = name, Exact = exact });

    public Task GotoAsync(string url, float timeout) =>
        Page.GotoAsync(url, new PageGotoOptions { WaitUntil = WaitUntilState.DOMContentLoaded, Timeout = timeout });

    public Task<T> EvaluateAsync<T>(string expression, object? argument = null) =>
        Page.EvaluateAsync<T>(expression, argument);

    public Task WaitForLoadStateAsync(LoadState state, float timeout) =>
        Page.WaitForLoadStateAsync(state, new PageWaitForLoadStateOptions { Timeout = timeout });
}

public sealed class FrameScope : IBrowserScope
{
    public FrameScope(IFrame frame) => Frame = frame;

    public IFrame Frame { get; }

    public ILocator Locator(string selector) => Frame.Locator(selector);

    public ILocator GetByText(string text, bool exact = true) =>
        Frame.GetByText(text, new FrameGetByTextOptions { Exact = exact });

    public ILocator GetByRole(AriaRole role, string name, bool exact = true) =>
        Frame.GetByRole(role, new FrameGetByRoleOptions { Name = name, Exact = exact });

    public Task GotoAsync(string url, float timeout) =>
        Frame.GotoAsync(url, new FrameGotoOptions { WaitUntil = WaitUntilState.DOMContentLoaded, Timeout = timeout });

    public Task<T> EvaluateAsync<T>(string expression, object? argument = null) =>
        Frame.EvaluateAsync<T>(expression, argument);

    public Task WaitForLoadStateAsync(LoadState state, float timeout) =>
        Frame.WaitForLoadStateAsync(state, new FrameWaitForLoadStateOptions { Timeout = timeout });
}
