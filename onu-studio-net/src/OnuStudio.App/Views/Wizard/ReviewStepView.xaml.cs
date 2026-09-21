using System.ComponentModel;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Threading;
using OnuStudio.App.ViewModels;

namespace OnuStudio.App.Views.Wizard;

public partial class ReviewStepView : UserControl
{
    private WizardViewModel? _wizard;

    public ReviewStepView()
    {
        InitializeComponent();
        DataContextChanged += (_, _) => Attach(DataContext as WizardViewModel);
    }

    private void Attach(WizardViewModel? wizard)
    {
        if (_wizard is not null) _wizard.PropertyChanged -= OnWizardChanged;
        _wizard = wizard;
        if (_wizard is not null) _wizard.PropertyChanged += OnWizardChanged;
    }

    /// <summary>Al aprovisionar y al terminar, el avance queda a la vista sin tener que bajar.</summary>
    private void OnWizardChanged(object? sender, PropertyChangedEventArgs args)
    {
        if (_wizard is null || !_wizard.IsStep5) return;
        if (args.PropertyName is not (nameof(WizardViewModel.IsBusy) or nameof(WizardViewModel.Finished))) return;
        Dispatcher.BeginInvoke(DispatcherPriority.Loaded, () =>
            ProgressCard.BringIntoView(new Rect(0, 0, ProgressCard.ActualWidth, ProgressCard.ActualHeight + 120)));
    }
}
