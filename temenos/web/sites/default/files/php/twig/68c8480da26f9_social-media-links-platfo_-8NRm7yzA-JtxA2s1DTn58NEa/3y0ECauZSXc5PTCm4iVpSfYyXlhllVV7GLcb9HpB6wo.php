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

/* modules/contrib/social_media_links/templates/social-media-links-platforms.html.twig */
class __TwigTemplate_12408b96dd6f2f2d4918f845c36e17a7 extends Template
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
        // line 6
        yield "
";
        // line 8
        $context["classes"] = ["social-media-links--platforms", "platforms", (((CoreExtension::getAttribute($this->env, $this->source,         // line 11
($context["appearance"] ?? null), "orientation", [], "any", false, false, true, 11) == "h")) ? ("inline horizontal") : ("vertical"))];
        // line 14
        yield "
<ul";
        // line 15
        yield $this->extensions['Drupal\Core\Template\TwigExtension']->escapeFilter($this->env, CoreExtension::getAttribute($this->env, $this->source, ($context["attributes"] ?? null), "addClass", [($context["classes"] ?? null)], "method", false, false, true, 15), "html", null, true);
        yield ">
  ";
        // line 16
        $context['_parent'] = $context;
        $context['_seq'] = CoreExtension::ensureTraversable(($context["platforms"] ?? null));
        foreach ($context['_seq'] as $context["_key"] => $context["platform"]) {
            // line 17
            yield "    <li>
      <a class=\"social-media-link-icon--";
            // line 18
            yield $this->extensions['Drupal\Core\Template\TwigExtension']->escapeFilter($this->env, CoreExtension::getAttribute($this->env, $this->source, $context["platform"], "id", [], "any", false, false, true, 18), "html", null, true);
            yield "\" href=\"";
            yield $this->extensions['Drupal\Core\Template\TwigExtension']->escapeFilter($this->env, $this->extensions['Drupal\social_media_links\TwigExtension\SocialMediaLinksTwigExtension']->safeLinkFilter(CoreExtension::getAttribute($this->env, $this->source, $context["platform"], "url", [], "any", false, false, true, 18)), "html", null, true);
            yield "\" ";
            yield $this->extensions['Drupal\Core\Template\TwigExtension']->escapeFilter($this->env, CoreExtension::getAttribute($this->env, $this->source, $context["platform"], "attributes", [], "any", false, false, true, 18), "html", null, true);
            yield " >
        ";
            // line 19
            yield $this->extensions['Drupal\Core\Template\TwigExtension']->escapeFilter($this->env, CoreExtension::getAttribute($this->env, $this->source, $context["platform"], "element", [], "any", false, false, true, 19), "html", null, true);
            yield "
      </a>

      ";
            // line 22
            if (CoreExtension::getAttribute($this->env, $this->source, ($context["appearance"] ?? null), "show_name", [], "any", false, false, true, 22)) {
                // line 23
                yield "        ";
                if ((CoreExtension::getAttribute($this->env, $this->source, ($context["appearance"] ?? null), "orientation", [], "any", false, false, true, 23) == "h")) {
                    // line 24
                    yield "          <br />
        ";
                }
                // line 26
                yield "
        <span><a class=\"social-media-link--";
                // line 27
                yield $this->extensions['Drupal\Core\Template\TwigExtension']->escapeFilter($this->env, CoreExtension::getAttribute($this->env, $this->source, $context["platform"], "id", [], "any", false, false, true, 27), "html", null, true);
                yield "\" href=\"";
                yield $this->extensions['Drupal\Core\Template\TwigExtension']->escapeFilter($this->env, $this->extensions['Drupal\social_media_links\TwigExtension\SocialMediaLinksTwigExtension']->safeLinkFilter(CoreExtension::getAttribute($this->env, $this->source, $context["platform"], "url", [], "any", false, false, true, 27)), "html", null, true);
                yield "\" ";
                yield $this->extensions['Drupal\Core\Template\TwigExtension']->escapeFilter($this->env, CoreExtension::getAttribute($this->env, $this->source, $context["platform"], "attributes", [], "any", false, false, true, 27), "html", null, true);
                yield ">";
                yield $this->extensions['Drupal\Core\Template\TwigExtension']->escapeFilter($this->env, CoreExtension::getAttribute($this->env, $this->source, $context["platform"], "name", [], "any", false, false, true, 27), "html", null, true);
                yield "</a></span>
      ";
            }
            // line 29
            yield "    </li>
  ";
        }
        $_parent = $context['_parent'];
        unset($context['_seq'], $context['_key'], $context['platform'], $context['_parent']);
        $context = array_intersect_key($context, $_parent) + $_parent;
        // line 31
        yield "</ul>
";
        $this->env->getExtension('\Drupal\Core\Template\TwigExtension')
            ->checkDeprecations($context, ["appearance", "attributes", "platforms"]);        yield from [];
    }

    /**
     * @codeCoverageIgnore
     */
    public function getTemplateName(): string
    {
        return "modules/contrib/social_media_links/templates/social-media-links-platforms.html.twig";
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
        return array (  108 => 31,  101 => 29,  90 => 27,  87 => 26,  83 => 24,  80 => 23,  78 => 22,  72 => 19,  64 => 18,  61 => 17,  57 => 16,  53 => 15,  50 => 14,  48 => 11,  47 => 8,  44 => 6,);
    }

    public function getSourceContext(): Source
    {
        return new Source("", "modules/contrib/social_media_links/templates/social-media-links-platforms.html.twig", "/home/ismigar/webapps/web/web/modules/contrib/social_media_links/templates/social-media-links-platforms.html.twig");
    }
    
    public function checkSecurity()
    {
        static $tags = ["set" => 8, "for" => 16, "if" => 22];
        static $filters = ["escape" => 15, "safe_link" => 18];
        static $functions = [];

        try {
            $this->sandbox->checkSecurity(
                ['set', 'for', 'if'],
                ['escape', 'safe_link'],
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
