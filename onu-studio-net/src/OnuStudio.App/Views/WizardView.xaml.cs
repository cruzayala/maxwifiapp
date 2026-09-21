using System.ComponentModel;
using System.Windows.Controls;
using OnuStudio.App.ViewModels;

namespace OnuStudio.App.Views;

public partial class WizardView : UserControl
{
    private WizardViewModel? _wizard;

    public WizardView()
    {
        InitializeComponent();
        DataContextChanged += (_, _) =>
        {
            if (_wizard is not null) _wizard.PropertyChanged -= OnWizardChanged;
            _wizard = DataContext as WizardViewModel;
            if (_wizard is not null) _wizard.PropertyChanged += OnWizardChanged;
        };
    }

    /// <summary>Cada tarjeta nueva se muestra desde arriba.</summary>
    private void OnWizardChanged(object? sender, PropertyChangedEventArgs args)
    {
        if (args.PropertyName is nameof(WizardViewModel.SubStep) or nameof(WizardViewModel.Step)
            or nameof(WizardViewModel.ShowProgressSection))
            Scroller.ScrollToTop();
    }
}
