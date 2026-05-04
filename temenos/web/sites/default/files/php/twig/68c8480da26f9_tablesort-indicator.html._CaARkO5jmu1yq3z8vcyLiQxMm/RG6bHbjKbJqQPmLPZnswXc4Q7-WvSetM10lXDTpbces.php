<?php

use Twig\Environment;
use Twig\Error\LoaderError;
use Twig\Error\RuntimeError;
use Twig\Extension\CoreExtension;
use Twig\Extension\SandboxExtension;
use Twig\Markup;
use Twig\Sandbox\SecurityError;
use Twig\Sandbox\SecurityNotAllowedTagError;
use Twig\Sandbox\SecurityNotAllowedFilterError;
use Twig\Sandbox\SecurityNotAllowedFunctionError;
use Twig\Source;
use Twig\Template;
use Twig\TemplateWrapper;

/* themes/contrib/stable/templates/admin/tablesort-indicator.html.twig */
class __TwigTemplate_345021af10acd20da8daf0910e4ca00b extends Template
{
    private Source $source;
    /**
     * @var array<string, Template>
     */
    private array $macros = [];

    public function __construct(Environment $env)
    {
        parent::__construct($env);

        $this->source = $this->getSourceContext();

        $this->parent = false;

        $this->blocks = [
        ];
        $this->sandbox = $this->extensions[SandboxExtension::class];
        $this->checkSecurity();
    }

    protected function doDisplay(array $context, array $blocks = []): iterable
    {
        $macros = $this->macros;
        // line 11
        $context["classes"] = ["tablesort", ("tablesort--" .         // line 13
($context["style"] ?? null))];
        // line 16
        yield "<span";
        yield $this->extensions['Drupal\Core\Template\TwigExtension']->escapeFilter($this->env, CoreExtension::getAttribute($this->env, $this->source, ($context["attributes"] ?? null), "addClass", [($context["classes"] ?? null)], "method", false, false, true, 16), "html", null, true);
        yield ">
  <span class=\"visually-hidden\">
    ";
        // line 18
        if ((($context["style"] ?? null) == "asc")) {
            // line 19
            yield $this->extensions['Drupal\Core\Template\TwigExtension']->renderVar(t("Sort ascending"));
            yield "
    ";
        } else {
            // line 21
            yield $this->extensions['Drupal\Core\Template\TwigExtension']->renderVar(t("Sort descending"));
            yield "
    ";
        }
        // line 23
        yield "  </span>
</span>
";
        $this->env->getExtension('\Drupal\Core\Template\TwigExtension')
            ->checkDeprecations($context, ["style", "attributes"]);        yield from [];
    }

    /**
     * @codeCoverageIgnore
     */
    public function getTemplateName(): string
    {
        return "themes/contrib/stable/templates/admin/tablesort-indicator.html.twig";
    }

    /**
     * @codeCoverageIgnore
     */
    public function isTraitable(): bool
    {
        return false;
    }

    /**
     * @codeCoverageIgnore
     */
    public function getDebugInfo(): array
    {
        return array (  65 => 23,  60 => 21,  55 => 19,  53 => 18,  47 => 16,  45 => 13,  44 => 11,);
    }

    public function getSourceContext(): Source
    {
        return new Source("", "themes/contrib/stable/templates/admin/tablesort-indicator.html.twig", "/home/ismigar/webapps/web/web/themes/contrib/stable/templates/admin/tablesort-indicator.html.twig");
    }
    
    public function checkSecurity()
    {
        static $tags = ["set" => 11, "if" => 18];
        static $filters = ["escape" => 16, "t" => 19];
        static $functions = [];

        try {
            $this->sandbox->checkSecurity(
                ['set', 'if'],
                ['escape', 't'],
                [],
                $this->source
            );
        } catch (SecurityError $e) {
            $e->setSourceContext($this->source);

            if ($e instanceof SecurityNotAllowedTagError && isset($tags[$e->getTagName()])) {
                $e->setTemplateLine($tags[$e->getTagName()]);
            } elseif ($e instanceof SecurityNotAllowedFilterError && isset($filters[$e->getFilterName()])) {
                $e->setTemplateLine($filters[$e->getFilterName()]);
            } elseif ($e instanceof SecurityNotAllowedFunctionError && isset($functions[$e->getFunctionName()])) {
                $e->setTemplateLine($functions[$e->getFunctionName()]);
            }

            throw $e;
        }

    }
}
