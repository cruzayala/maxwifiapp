using System.Windows;
using System.Windows.Controls;

namespace OnuStudio.App.Controls;

/// <summary>
/// La tarjeta central del asistente: una sola pregunta a la vez, con su numero en un
/// circulo que se vuelve un check verde al responderla. El aspecto vive en Theme.xaml.
/// </summary>
public sealed class WizardSection : ContentControl
{
    public static readonly DependencyProperty NumberProperty =
        DependencyProperty.Register(nameof(Number), typeof(string), typeof(WizardSection), new PropertyMetadata("1"));

    public string Number
    {
        get => (string)GetValue(NumberProperty);
        set => SetValue(NumberProperty, value);
    }

    public static readonly DependencyProperty TitleProperty =
        DependencyProperty.Register(nameof(Title), typeof(string), typeof(WizardSection), new PropertyMetadata(string.Empty));

    public string Title
    {
        get => (string)GetValue(TitleProperty);
        set => SetValue(TitleProperty, value);
    }

    public static readonly DependencyProperty HintProperty =
        DependencyProperty.Register(nameof(Hint), typeof(string), typeof(WizardSection), new PropertyMetadata(string.Empty));

    public string Hint
    {
        get => (string)GetValue(HintProperty);
        set => SetValue(HintProperty, value);
    }

    public static readonly DependencyProperty IsDoneProperty =
        DependencyProperty.Register(nameof(IsDone), typeof(bool), typeof(WizardSection), new PropertyMetadata(false));

    public bool IsDone
    {
        get => (bool)GetValue(IsDoneProperty);
        set => SetValue(IsDoneProperty, value);
    }
}
